const {Database} = require('./database.js');
require('dotenv').config();
const {spawn} = require('child_process');
const db = new Database();
const express = require('express');
const app = express();
const http = require('http');
const WebSocket = require('ws');

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients
const clients = new Set();

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');
  clients.add(ws);

  // Send initial data to new client
  const initialData = getCurrentData();
  ws.send(JSON.stringify({
    type: 'data',
    payload: initialData
  }));

  // Handle client disconnect
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// Function to get current data
function getCurrentData() {
  let path = './database.json';
  delete require.cache[require.resolve(path)];
  let d = require(path);
  const config = require('./config.js');
  const stockTemplates = new Map(config.stockPrices.map((stock) => [stock.name, stock]));
  let dirty = false;

  if (Array.isArray(d.stockprices)) {
    d.stockprices = d.stockprices.map((stock) => {
      const template = stockTemplates.get(stock.name) || {};
      const stocksbought = Number(stock.stocksbought ?? stock.stocksBought ?? 0);
      const normalized = {
        ...template,
        ...stock,
        stocksbought,
      };
      delete normalized.stocksBought;
      if (stock.stocksbought !== stocksbought || stock.stocksBought !== undefined || template.sector !== stock.sector || template.totalStock !== stock.totalStock) {
        dirty = true;
      }
      return normalized;
    });
  }

  if (Array.isArray(d.schooldata) && Array.isArray(d.stockprices)) {
    d.schooldata.forEach((school) => {
      if (!Array.isArray(school.stocks)) school.stocks = [];
      while (school.stocks.length < d.stockprices.length) {
        school.stocks.push(0);
        dirty = true;
      }
    });
  }

  // Ensure shorts array always exists in the payload
  if (!Array.isArray(d.shorts)) {
    d.shorts = [];
  }
  
  // Initialize stockPriceHistory if it doesn't exist
  if (!d.stockPriceHistory) {
    d.stockPriceHistory = [];
    for(let i = 0; i < d.stockprices.length; i++) {
      d.stockPriceHistory.push([{
        price: d.stockprices[i].price,
        timestamp: new Date().toISOString(),
        change: 0
      }]);
    }
    // Save the updated data
    const fs = require('fs');
    fs.writeFileSync('./database.json', JSON.stringify(d));
    dirty = false;
  } else if (dirty) {
    fs.writeFileSync('./database.json', JSON.stringify(d));
  }
  
  d.tradetime = tradetime;
  return d;
}

// Function to broadcast data to all connected clients
function broadcastData() {
  if (clients.size === 0) return;

  const data = getCurrentData();
  const message = JSON.stringify({
    type: 'data',
    payload: data
  });

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    } else {
      clients.delete(client);
    }
  });
}

// Broadcast data every second
setInterval(broadcastData, 1000);

server.listen(3000, () => {
  console.log('App ready!');
});

let bodyParser = require('body-parser');
let crypto = require('crypto');
let cookies = require('cookie-parser');
let tradetime = true;
const dotenv = require('dotenv');
dotenv.config();

app.use(express.static('images'));
app.use(cookies());
app.use(bodyParser.urlencoded({extended: false}));
app.get('/stockPrices',(req,res)=>{
  res.sendFile(__dirname + '/html/stockprices.html');
})
const path = require('path');
app.use(
"/static",
express.static(path.join(process.cwd(), "static"), {
maxAge: "1y", // cache for a year
immutable: true, // tells the browser it never changes
etag: true, // allow 304 revalidation if needed
lastModified: true, // (default) also fine
setHeaders(res, filePath) {
// Make it explicit and compatible with CDNs
res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
// Optional: precompressed files if you have them (see §4)
// res.setHeader("Vary", "Accept-Encoding");
},
})
);

app.get('/sellStock', (req, res) => {
  const stock = req.query.stock;
  const schoolToken = req.query.school;
  const n = parseInt(req.query.n) || 1;
  if (!schoolToken || typeof schoolToken !== 'string' || !schoolToken.includes('_')) {
    return res.status(400).json({error: 'Invalid school token'});
  }
  const school = schoolToken.split('_')[0];
  const schoolPass = schoolToken.split('_')[1];

  const acc = JSON.parse(process.env.accounts);
  if (!tradetime) return res.json({error: 'Trade Time is Disabled!'});
  console.log(stock);
  console.log(school);
  for (let i = 0; i < acc.length; i++) {
    let un = acc[i].username;
    let ps = acc[i].password;

    if (un == school && ps == schoolPass) {
      const result = db.sellStock(school, stock, n);
      // Handle new response format from database
      if (typeof result === 'object' && result.success !== undefined) {
        return res.json(result);
      } else {
        // Legacy response format (just a number)
        return res.json({newQuantity: result});
      }
    }
  }
  return res.json({error: 'Invalid Auth'});
});

app.get('/buyStock', (req, res) => {
  const stock = req.query.stock;
  const schoolToken = req.query.school;
  const n = parseInt(req.query.n) || 1;
  if (!schoolToken || typeof schoolToken !== 'string' || !schoolToken.includes('_')) {
    return res.status(400).json({error: 'Invalid school token'});
  }
  const school = schoolToken.split('_')[0];
  const schoolPass = schoolToken.split('_')[1];
  if (!tradetime) return res.json({error: 'Trade Time is Disabled!'});
  const acc = JSON.parse(process.env.accounts);
  console.log(stock);
  console.log(school);
  for (let i = 0; i < acc.length; i++) {
    let un = acc[i].username;
    let ps = acc[i].password;

    if (un == school && ps == schoolPass) {
      const result = db.buyStock(school, stock, n);
      // Handle new response format from database
      if (typeof result === 'object' && result.success !== undefined) {
        return res.json(result);
      } else {
        // Legacy response format (just a number)
        return res.json({newQuantity: result});
      }
    }
  }
  return res.json({error: 'Invalid Auth'});
});
/*
app.get('/index', (req, res) => {
  return res.sendFile(__dirname + '/html/index.html');
});
*/
app.get('/index', (req, res) => {
  return res.sendFile(__dirname + '/html/merged-portfolio.html');
});


app.get('/api/stockPrices', (req, res) => {
  let sl = db.getstockList();
  res.json(sl);
});
app.get('/', (req, res) => {
  return res.sendFile(__dirname + '/html/login.html');
});

app.post('/login', (req, res) => {
  let usr = req.body.username.toUpperCase();
  let pass = req.body.password;
  const acc = JSON.parse(process.env.accounts);
  if (!usr || !pass) {
    return res.redirect('/?error=Invalid%20username%20or%20password');
  }
  for (let i = 0; i < acc.length; i++) {
    let un = acc[i].username;
    let ps = acc[i].password;
    if (un == usr && ps == pass) {
      return res.cookie('ssid', usr + '_' + pass).redirect('/index');
    }
  }
  return res.redirect('/?error=Invalid%20username%20or%20password');
});

app.get('/data', (req, res) => {
  const data = getCurrentData();
  return res.status(200).json(data);
});

app.get('/getAllPrices', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    let d = JSON.parse(process.env.all_prices);
    d.tradetime = tradetime;
    return res.json(d);
  } else {
    return res.json({data: 'false'});
  }
});

app.get('/setAllPrices', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    let arr = JSON.parse(req.query.arr);
    db.setAllPrices(req.query.which, arr);
    return res.json({data: 'success'});
  } else {
    return res.json({data: 'false'});
  }
});
app.get('/getAllAccounts', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    return res.sendFile(__dirname+"/accounts.json");
  } else {
    return res.status(500).json({data: 'false'});
  }
});

app.get('/whitePrices', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    db.whitePrices();
    return res.json({data: 'success'});
  } else {
    return res.json({data: 'false'});
  }
});

app.get('/tt', (req, res) => {
  res.json({tradetime: tradetime});
});

app.get('/portfolio', (req, res) => {
  res.sendFile(__dirname + '/html/portfolio.html');
});

app.get('/admin', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    return res.sendFile(__dirname + '/html/admin.html');
  }
  res.send(`<!DOCTYPE html><html><head><title>Admin Login</title><link href="/static/tailwind.min.css" rel="stylesheet"/><style>body{background:#0f172a;color:#f8fafc;font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}</style></head><body><div style="text-align:center"><h1 style="font-size:2rem;font-weight:700;margin-bottom:1rem">Admin Access</h1><p style="color:#94a3b8;margin-bottom:2rem" id="msg">Click below to authenticate.</p><button onclick="login()" style="border:2px solid #f59e0b;color:#f59e0b;background:rgba(245,158,11,0.1);padding:1rem 2rem;border-radius:12px;font-weight:700;font-size:1rem;cursor:pointer">Login</button></div><script>function login(){var u=prompt("Username");var p=prompt("Password");if(u&&p){window.location.href="/admin?u="+encodeURIComponent(u)+"&p="+encodeURIComponent(p)}else{window.location.href="/"}}</script></body></html>`);
});
const u = process.env.un;
const p = process.env.pass;

app.get('/adminauth', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    return res.json({data: 'true'});
  } else {
    return res.json({data: 'false'});
  }
});

app.get('/setTT', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    tradetime = req.query.value === 'true';
    db.setTradetime(tradetime);
    return res.json({data: 'success'});
  } else {
    return res.json({data: 'false'});
  }
});
app.get('/setSP', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    db.setPrice(req.query.n, req.query.value);
    return res.json({data: 'success'});
  } else {
    return res.json({data: 'false'});
  }
});

app.get('/resetDB', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    db.resetDatabase();
    tradetime = true;
    broadcastData();
    return res.json({data: 'success'});
  } else {
    return res.json({data: 'false'});
  }
});

app.get('/updatePricesByPercentage', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    const pct = parseFloat(req.query.percent);
    if (isNaN(pct)) return res.json({success: false, message: 'Invalid percentage'});
    const result = db.updatePricesByPercentage(pct);
    broadcastData();
    return res.json(result);
  } else {
    return res.json({success: false, message: 'Unauthorized'});
  }
});

app.get('/updatePriceByPercentage', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    const pct = parseFloat(req.query.percent);
    if (isNaN(pct)) return res.json({success: false, message: 'Invalid percentage'});
    const result = db.updatePriceByPercentage(req.query.stock, pct);
    broadcastData();
    return res.json(result);
  } else {
    return res.json({success: false, message: 'Unauthorized'});
  }
});

app.get('/setSuspension', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    const action = req.query.action === 'suspend' ? 'suspend' : 'resume';
    const result = action === 'suspend' ? db.suspendStock(req.query.stock) : db.resumeStock(req.query.stock);
    broadcastData();
    return res.json(result);
  } else {
    return res.json({success: false, message: 'Unauthorized'});
  }
});

app.get('/ipoCalculate', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    let bids = [];
    try { bids = JSON.parse(req.query.bids); } catch (e) { return res.json({success: false, message: 'Invalid bids JSON'}); }
    const supply = parseInt(req.query.supply) || 0;
    const result = db.calculateIpoPrice(bids, supply);
    return res.json(result);
  } else {
    return res.json({success: false, message: 'Unauthorized'});
  }
});

app.get('/ipoLaunch', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    let bids = [];
    try { bids = JSON.parse(req.query.bids); } catch (e) { return res.json({success: false, message: 'Invalid bids JSON'}); }
    const supply = parseInt(req.query.supply) || 0;
    const result = db.launchIpo(req.query.name, req.query.sector, supply, bids);
    broadcastData();
    return res.json(result);
  } else {
    return res.json({success: false, message: 'Unauthorized'});
  }
});

app.get('/transferShares', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    const result = db.transferShares(
      req.query.from, req.query.to,
      req.query.stock, parseInt(req.query.qty),
      parseFloat(req.query.price)
    );
    broadcastData();
    return res.json(result);
  } else {
    return res.json({success: false, message: 'Unauthorized'});
  }
});

app.get('/createTradeOffer', (req, res) => {
  const schoolToken = req.query.school;
  if (!schoolToken || !schoolToken.includes('_')) return res.status(400).json({success: false, message: 'Invalid auth'});
  const school = schoolToken.split('_')[0];
  const schoolPass = schoolToken.split('_')[1];
  const acc = JSON.parse(process.env.accounts);
  const found = acc.some(a => a.username == school && a.password == schoolPass);
  if (!found) return res.json({success: false, message: 'Invalid auth'});
  const result = db.createTradeOffer(
    school, req.query.to,
    req.query.stock, parseInt(req.query.qty),
    parseFloat(req.query.price)
  );
  return res.json(result);
});

app.get('/acceptTradeOffer', (req, res) => {
  const schoolToken = req.query.school;
  if (!schoolToken || !schoolToken.includes('_')) return res.status(400).json({success: false, message: 'Invalid auth'});
  const school = schoolToken.split('_')[0];
  const schoolPass = schoolToken.split('_')[1];
  const acc = JSON.parse(process.env.accounts);
  const found = acc.some(a => a.username == school && a.password == schoolPass);
  if (!found) return res.json({success: false, message: 'Invalid auth'});
  if (!tradetime) return res.json({success: false, message: 'Market is frozen. Trade offers can only be accepted during active trading.'});
  // Validate that this offer is addressed to this school
  delete require.cache[require.resolve('./database.json')];
  const data = require('./database.json');
  const offer = (data.tradeOffers || []).find(o => o.id === req.query.offerId);
  if (!offer) return res.json({success: false, message: 'Offer not found'});
  if (offer.toSchool !== school) return res.json({success: false, message: 'This offer is not for your team'});
  const result = db.acceptTradeOffer(req.query.offerId);
  broadcastData();
  return res.json(result);
});

app.get('/getMyTradeOffers', (req, res) => {
  const schoolToken = req.query.school;
  if (!schoolToken || !schoolToken.includes('_')) return res.status(400).json({success: false, message: 'Invalid auth'});
  const school = schoolToken.split('_')[0];
  const schoolPass = schoolToken.split('_')[1];
  const acc = JSON.parse(process.env.accounts);
  const found = acc.some(a => a.username == school && a.password == schoolPass);
  if (!found) return res.json({success: false, message: 'Invalid auth'});
  delete require.cache[require.resolve('./database.json')];
  const data = require('./database.json');
  const offers = (data.tradeOffers || []).filter(o => o.fromSchool === school || o.toSchool === school);
  return res.json({success: true, offers});
});

app.get('/marketFreeze', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    const result = db.marketFreeze();
    if (result.success) tradetime = false;
    broadcastData();
    return res.json(result);
  } else {
    return res.json({success: false, message: 'Unauthorized'});
  }
});

app.get('/marketStart', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    const result = db.marketStart();
    if (result.success) tradetime = true;
    broadcastData();
    return res.json(result);
  } else {
    return res.json({success: false, message: 'Unauthorized'});
  }
});

app.get('/calculateScores', (req, res) => {
  const results = db.calculateScores();
  return res.json(results);
});

app.get('/getFreezeScores', (req, res) => {
  const scores = db.getFreezeScores();
  return res.json(scores);
});

app.get('/getFinalScores', (req, res) => {
  const scores = db.getFinalScores();
  return res.json(scores);
});

app.get('/getTradeLog', (req, res) => {
  const log = db.getTradeLog();
  return res.json(log);
});

app.get('/leaderboard', (req, res) => {
  return res.sendFile(__dirname + '/html/leaderboard.html');
});

app.get('/leaderboardData', (req, res) => {
  const results = db.calculateScores();
  return res.json(results);
});

app.get('/declareDividends', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    const result = db.declareDividends();
    broadcastData();
    return res.json(result);
  }
  return res.json({ success: false, message: 'Unauthorized' });
});

app.get('/declareDividend', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    const result = db.declareDividend(req.query.team);
    broadcastData();
    return res.json(result);
  }
  return res.json({ success: false, message: 'Unauthorized' });
});

app.get('/addShort', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    const result = db.addShort(req.query.team, req.query.stock, req.query.shares, req.query.note);
    broadcastData();
    return res.json(result);
  }
  return res.json({ success: false, message: 'Unauthorized' });
});

app.get('/getShorts', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    return res.json(db.getShorts());
  }
  return res.json({ success: false, message: 'Unauthorized' });
});

app.get('/withdrawShort', (req, res) => {
  if (req.query.u == u && req.query.p == p) {
    const result = db.withdrawShort(req.query.shortId, req.query.note);
    broadcastData();
    return res.json(result);
  }
  return res.json({ success: false, message: 'Unauthorized' });
});
