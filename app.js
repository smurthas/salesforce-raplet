var request = require('request');
var express = require('express');
var https = require('https');
var fs = require('fs');
var ejs = require('ejs');

var client_id = process.env.CLIENT_ID;
var client_secret = process.env.CLIENT_SECRET;
var redirect_uri = process.env.REDIRECT_URI;
console.error('redirect_uri', redirect_uri);

var CLIENT;
if (process.env.ACCESS_TOKEN && process.env.INSTANCE_URL &&
    process.env.ID) {
  var auth = {
    id: process.env.ID,
    access_token: process.env.ACCESS_TOKEN,
    instance_url: process.env.INSTANCE_URL
  };
  CLIENT = new Client(auth.access_token, auth.instance_url, 'v26.0');
}

var host = 'https://login.salesforce.com'

var app = express(express.bodyParser());

function jsonP(req, res, obj) {
  var callback = req.query.callback;
  var str = callback + '(' + JSON.stringify(obj) + ')';
  console.error('str', str);
  res.send(str);
}

app.get('/raplet', function(req, res) {
  var email = req.query.email;
  getInfoFromEmail(email, function(err, info) {
    if (!info) return res.send(404);
    return jsonP(req, res, {
      html: ejs.render(fs.readFileSync('views/raplet.html').toString(), info),
      css: fs.readFileSync(__dirname + '/css/style.css').toString(),
      js: fs.readFileSync(__dirname + '/js/raplet.js').toString(),
      status: 200
    });
  });
});

function getInfoFromEmail(email, callback) {
  getContacts(email, function(err, results) {
    if (err) return callback(err, results);
    var c = results.records[0];
    if (!c) return callback();
    getObject('Account', c.AccountId, function(err, account) {
      if (err) return callback(err, account);
      if (!account) return callback();
      getObject('User', account.OwnerId, function(err, owner) {
        if (err) return callback(err);
        if (!owner) return callback();
        getRecentEmails(c.AccountId, function(err, emails) {
          callback(null, {
            account: {
              name: account.Name
            },
            contact: {
              title: c.Title
            },
            owner: {
              alias: owner.Alias,
              thumbnail: owner.SmallPhotoUrl
            },
            emails: emails || []
          });
        });
      });
    })
  });
}

function getRecentEmails(account, callback) {
  var fields= 'Subject,Status,OwnerId,Description,LastModifiedDate,ActivityDate';
  var q = 'SELECT ' + fields + ' FROM Task ' +
          'WHERE AccountId = \'' + account + '\' AND Status = \'Completed\'';

  CLIENT.get('/query/', {q:q}, function(err, resp, results) {
    var emails = [];
    if (!results.records) return callback();
    results.records.forEach(function(task) {
      if (task.Subject.indexOf('Email: ') !== 0) return;
      var t = {
        at: new Date(task.ActivityDate || task.LastModifiedDate).getTime(),
        owner_id: task.OwnerId,
      };
      console.error('task.Subject', task.Subject);
      t.subject = task.Subject.substring(7);
      //console.error('task.Description', task.Description);
      var preBody = t.subject + '\nBody:';
      var bodyStart = task.Description.indexOf(preBody);
      if (bodyStart !== -1) {
        var body = task.Description.substring(bodyStart + preBody.length + 1);
        var headers = task.Description.substring(0, bodyStart + preBody.length - 6);
        t.body = body;
        t.headers = {
          raw: headers
        };
        var toStart = headers.indexOf('To:');
        if (toStart !== -1) {
          var to = headers.substring(headers.indexOf('To: '));
          to = to.substring(4, to.indexOf('\n'));
          headers.to = to.split('; ');
        }
      }
      emails.push(t);
    });
    emails.sort(function(a, b) {
      if (a.at < b.at) return 1;
      if (a.at > b.at) return -1;
      return 0;
    })
    callback(err, emails);
    //callback(err, {results:results.records, emails:emails});
  });

}

app.get('/emails/:accountID', function(req, res) {
  getRecentEmails(req.params.accountID, function(err, emails) {
    res.json(emails);
  });
});

app.get('/query', function(req, res) {
  var q = req.query.q;
  console.error('q', q);
  CLIENT.get('/query/', {q:q}, function(err, resp, results) {
    res.json(results);
  });
});

app.get('/', function(req, res) {
  var url = host + '/services/oauth2/authorize?response_type=code&client_id=' +
    client_id + '&redirect_uri=' + encodeURIComponent(redirect_uri);
  console.error('url', url);
  res.redirect(url);
});


app.get('/auth/callback', function(req, res) {
  var code = req.query.code;
  var body = {
    grant_type: 'authorization_code',
    client_id: client_id,
    client_secret: client_secret,
    redirect_uri: redirect_uri,
    code: code,
    format: 'json'
  };
  console.error('body', body);
  request.post({uri: host + '/services/oauth2/token', form: body, json: true},
    function(err, resp, auth) {
    console.error('err', err);
    console.error('auth',auth);
    CLIENT = new Client(auth.access_token, auth.instance_url, 'v26.0');
    CLIENT.id(auth.id, function(err, resp, user) {
      doSearch('Timehop', function(err, results) {
        res.json({
          auth: auth,
          user: user,
          results: results
        });
      });
    });
  });
});

app.get('/search', function(req, res) {
  var term = req.query.q;
  doSearch(term, function(err, results) {
    res.json(results);
  });
});

app.get('/accounts', function(req, res) {
  var term = req.query.q;
  getAccounts(term, function(err, results) {
    res.json(results);
  });
});

app.get('/contacts', function(req, res) {
  var email = req.query.email;
  getContacts(email, function(err, results) {
    res.json(results);
  });
});

app.get('/object/:table/:id', function(req, res) {
  getObject(req.params.table, req.params.id, function(err, obj) {
    res.json(obj);
  });
});

function getObject(table, id, callback) {
  CLIENT.get('/sobjects/' + table + '/' + id, {}, function(err, resp, result) {
    callback(err, result);
  });
}

function doSearch(term, callback) {
  CLIENT.get('/search/', {q:'FIND {' + term + '}'}, function(err, resp, results) {
    callback(err, results)
  });
}

function getAccounts(term, callback) {
  CLIENT.get('/query/', {q:'SELECT name from Account'}, function(err, resp, results) {
    callback(err, results);
  });
}

function getContacts(email, callback) {
  var q = 'SELECT email,name,AccountId,Title from Contact';
  if (email) {
    q += ' WHERE Email = \'' + email + '\'';
  }
  CLIENT.get('/query/', {q:q}, function(err, resp, results) {
    callback(err, results);
  });
}


function Client(token, instance_url, version) {
  instance_url += '/services/data/' + version;
  var headers = {
    Authorization: 'Bearer ' + token
  };
  return {
    id: function(url, callback) {
      request.get({uri:url, qs:{oauth_token:token}, json:true}, callback);
    },
    get: function(path, params, callback) {
      //params.oauth_token = token;
      var uri = instance_url + path;
      console.error('uri', uri);
      request.get({uri: uri, qs: params, json:true, headers: headers}, callback);
    }
  };
}

if (process.env.HTTPS) {
  https.createServer({
    key:fs.readFileSync('./server.key'),
    cert:fs.readFileSync('./server.crt')},
    app).listen(process.env.PORT);
} else {
  app.listen(process.env.PORT);
}
