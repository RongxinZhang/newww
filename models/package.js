var _ = require('lodash');
var cache = require('../lib/cache');
var decorate = require('../presenters/package');
var fmt = require('util').format;
var P = require('bluebird');
var request = require('../lib/external-request');
var qs = require('qs');
var VError = require('verror');

var Package = module.exports = function(opts) {
  _.extend(this, {
    host: process.env.USER_API || "https://user-api-example.com",
    bearer: false
  }, opts);

  return this;
};

Package.new = function(request) {
  var opts = {
    bearer: request.loggedInUser && request.loggedInUser.name
  };

  return new Package(opts);
};

Package.prototype.generatePackageOpts = function generatePackageOpts(name) {
  var opts = {
    url: fmt("%s/package/%s", this.host, name.replace("/", "%2F")),
    json: true
  };

  if (this.bearer) {
    opts.headers = {
      bearer: this.bearer
    };
  }

  return opts;
};

Package.prototype.get = function(name) {
  var opts = this.generatePackageOpts(name);

  return cache.getP(opts).then(maybeUpgradeRRPackageData).tap(assertPackageIsWellFormed).then(decorate);

};

Package.prototype.dropCache = function dropCache(name) {
  return cache.dropP(this.generatePackageOpts(name));
};

Package.prototype.update = function(name, body) {

  var url = fmt("%s/package/%s", this.host, name.replace("/", "%2F"));
  var opts = {
    method: "POST",
    url: url,
    json: true,
    body: _.pick(body, 'private') // remove all other props
  };

  // hapi is converting the private boolean to a string
  // so... yeah.
  if (opts.body && 'private' in opts.body) {
    opts.body.private = (String(opts.body.private) === "true");
  }

  if (this.bearer) {
    opts.headers = {
      bearer: this.bearer
    };
  }

  return this.dropCache(name)
    .then(function() {
      return new P(function(resolve, reject) {
        request(opts, function(err, resp, body) {
          if (err) {
            return reject(err);
          }
          if (resp.statusCode > 399) {
            err = new Error('error updating package ' + name);
            err.statusCode = resp.statusCode;
            return reject(err);
          }
          return resolve(body);
        });
      });
    })
    .then(function(_package) {
      return _package ? decorate(_package) : {
        package: name,
        updated: true
      };
    });
};

Package.prototype.list = function(options, ttl) {
  var url = fmt("%s/package?%s", this.host, qs.stringify(options));

  var opts = {
    url: url,
    json: true,
    ttl: ttl || 500 // seconds
  };

  return cache.getP(opts).then(function upgradeRRResponse(result) {
    if (Array.isArray(result)) {
      return {
        results: result
      };
    } else {
      return result;
    }
  });
};

Package.prototype.count = function() {
  var url = fmt("%s/package/-/count", this.host);
  var opts = {
    url: url,
    json: true
  };

  return cache.getP(opts);
};

Package.prototype.star = function(pkg) {

  var _this = this;
  var url = fmt("%s/package/%s/star", _this.host, encodeURIComponent(pkg));
  var opts = {
    url: url,
    json: true,
  };

  if (_this.bearer) {
    opts.headers = {
      bearer: _this.bearer
    };
  }

  return this.dropCache(pkg)
    .then(function() {
      return new P(function(resolve, reject) {

        request.put(opts, function(err, resp) {
          if (err) {
            return reject(err);
          }
          if (resp.statusCode > 399) {
            err = new Error('error starring package ' + pkg);
            err.statusCode = resp.statusCode;
            return reject(err);
          }

          return resolve(pkg + ' starred by ' + _this.bearer);
        });
      });
    });
};

Package.prototype.unstar = function(pkg) {

  var _this = this;
  var url = fmt("%s/package/%s/star", _this.host, encodeURIComponent(pkg));
  var opts = {
    url: url,
    json: true,
  };

  if (_this.bearer) {
    opts.headers = {
      bearer: _this.bearer
    };
  }

  return this.dropCache(pkg)
    .then(function() {
      return new P(function(resolve, reject) {

        request.del(opts, function(err, resp) {
          if (err) {
            return reject(err);
          }

          if (resp.statusCode > 399) {
            err = new Error('error unstarring package ' + pkg);
            err.statusCode = resp.statusCode;
            return reject(err);
          }

          return resolve(pkg + ' unstarred by ' + _this.bearer);
        });
      });
    });
};

function maybeUpgradeRRPackageData(pkg) {
  if (Object.keys(pkg).length == 1) {
    return pkg[Object.keys(pkg)[0]];
  } else {
    return pkg;
  }
}

function assertPackageIsWellFormed(pkg) {
  if (!pkg || !pkg.name) {
    throw new VError("Package is not well formed: %j", pkg);
  }
}
