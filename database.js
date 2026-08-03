const fs = require('fs');
const filepath = './database.json';

function normalizeStockRecord(stock) {
  const normalized = {...stock, stocksbought: Number(stock.stocksbought ?? stock.stocksBought ?? 0)};
  delete normalized.stocksBought;
  return normalized;
}

function makeid(length) {
  let result = '';
  const characters =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  let counter = 0;
  while (counter < length) {
    result += characters.charAt(
        Math.floor(Math.random() * charactersLength),
    );
    counter += 1;
  }
  return result;
}

class Database {
  constructor() {
    const config = require("./config.js");
    const acc = JSON.parse(process.env.accounts);
    
    let schools = []
    for(let i=0;i<acc.length;i++){
      schools.push(acc[i].username);
    }
    var database = {
      schooldata: [],
      stockprices: [],
      stockPriceHistory: [],
    };
    database.stockprices = config.stockPrices.map(normalizeStockRecord);
    const sp = JSON.parse(process.env.all_prices);

    database.allPrices = [sp[0]];
    for(let i=0;i<sp.length;i++){
      database.allPrices.push([]);
    }
    database.whitePrices = false;
    database.tradeLog = [];
    database.freezeScores = [];
    database.tradeOffers = [];
    database.lastFreezeSnapshot = null;
    database.tradetime = true;
    database.suspendedStocks = [];
    
    // Initialize stock price history with current prices and timestamps
    database.stockPriceHistory = [];
    for(let i = 0; i < database.stockprices.length; i++) {
      database.stockPriceHistory.push([{
        price: database.stockprices[i].price,
        timestamp: new Date().toISOString(),
        change: 0
      }]);
    }
    const fs = require('fs');

    //        var accounts = [];
    for (let i = 0; i < schools.length; i++) {
      database.schooldata.push({
        schoolcode: schools[i],
        stocks: Array(database.stockprices.length).fill(0),
        cash: config.cash,
      });
      // accounts[i] = {"username":schools[i],"password":makeid(6)};
    }
    //console.log(database);
    
    this.ogdb = database;
    //console.log(database==this.ogdb);
    fs.writeFileSync('./database.json', JSON.stringify(database));
    //  fs.writeFileSync("./accounts.json", JSON.stringify(accounts));
  }
  
  // Helper method to update stock price history
  updateStockPriceHistory(stockIndex, oldPrice, newPrice) {
    const db = require('./database.json');
    
    // Initialize stockPriceHistory if it doesn't exist
    if (!db.stockPriceHistory) {
      db.stockPriceHistory = [];
      for(let i = 0; i < db.stockprices.length; i++) {
        db.stockPriceHistory.push([{
          price: db.stockprices[i].price,
          timestamp: new Date().toISOString(),
          change: 0
        }]);
      }
    }
    
    // Ensure the stock index has a history array
    if (!db.stockPriceHistory[stockIndex]) {
      db.stockPriceHistory[stockIndex] = [{
        price: oldPrice,
        timestamp: new Date().toISOString(),
        change: 0
      }];
    }
    
    // Add new price point if the price actually changed
    if (oldPrice !== newPrice) {
      const change = ((newPrice - oldPrice) / oldPrice) * 100;
      
      db.stockPriceHistory[stockIndex].push({
        price: parseFloat(newPrice),
        timestamp: new Date().toISOString(),
        change: parseFloat(change.toFixed(2))
      });
      
      // Keep only last 100 price points to prevent database from growing too large
      if (db.stockPriceHistory[stockIndex].length > 100) {
        db.stockPriceHistory[stockIndex] = db.stockPriceHistory[stockIndex].slice(-100);
      }
    }
    
    return db;
  }
  buyStock(school, stockname, n) {
    const db = require('./database.json');
    const schoolIndex = db.schooldata.findIndex(
        (schoolData) => schoolData.schoolcode === school,
    );
    const stockIndex = db.schooldata[schoolIndex].stocks.findIndex(
        (stock, index) => stockname === db.stockprices[index].name,
    );

    // Check if the stock is suspended from trading
    if ((db.suspendedStocks || []).includes(stockname)) {
      return { success: false, message: `${stockname} is currently suspended from trading`, stocks: db.schooldata[schoolIndex].stocks[stockIndex] };
    }

    // Check if sufficient cash is available
    if (db.schooldata[schoolIndex].cash < (db.stockprices[stockIndex].price) * n) {
      return { success: false, message: "Insufficient funds", stocks: db.schooldata[schoolIndex].stocks[stockIndex] };
    }
    
    // Check if sufficient volume is available
    const availableVolume = db.stockprices[stockIndex].totalStock - (db.stockprices[stockIndex].stocksbought || 0);
    if (availableVolume < n) {
      return { success: false, message: "Insufficient volume available", stocks: db.schooldata[schoolIndex].stocks[stockIndex] };
    }
    
    // Execute the transaction
    db.schooldata[schoolIndex].stocks[stockIndex] += n;
    db.stockprices[stockIndex].lastBoughtBy = school;
    // NOTE: lastBoughtPrice will be set after price calculation
    db.stockprices[stockIndex].lastBoughtQty = n;
    db.schooldata[schoolIndex].cash -= (db.stockprices[stockIndex].price) * n;
    
    // Update stocks bought counter
    if (!db.stockprices[stockIndex].stocksbought) {
      db.stockprices[stockIndex].stocksbought = 0;
    }
    db.stockprices[stockIndex].stocksbought += n;
    
    // Calculate price impact based on market dynamics (reduced impact)
    let p = Number(db.stockprices[stockIndex].price);
    const oldPrice = p;
    
    // Market demand ratio (how much of total stock is already bought)
    const demandRatio = db.stockprices[stockIndex].stocksbought / db.stockprices[stockIndex].totalStock;
    
    // Volume impact (larger purchases have more impact)
    const volumeImpact = n / db.stockprices[stockIndex].totalStock;
    
    // Reduced base impact rate (starts at 0.2% for low demand, scales up to 0.8% for high demand)
    const baseImpactRate = 0.002 + (demandRatio * 0.006);
    
    // Reduced volume multiplier (much smaller exponential impact)
    const volumeMultiplier = 1 + Math.pow(volumeImpact * 50, 0.5);
    
    // Reduced scarcity multiplier (gentler price increases)
    const scarcityMultiplier = 1 + (demandRatio * 0.8);
    
    // Final impact calculation with overall dampener
    const priceImpact = baseImpactRate * volumeMultiplier * scarcityMultiplier * 0.6;
    
    // Apply the price increase
    p = parseFloat((p * (1 + priceImpact)).toFixed(2));
    
    db.stockprices[stockIndex].price = p.toFixed(2);
    
    // NOW set lastBoughtPrice to the actual final price they paid (after impact)
    db.stockprices[stockIndex].lastBoughtPrice = p.toFixed(2);
    
    // Update price history
    const updatedDb = this.updateStockPriceHistory(stockIndex, oldPrice, p);
    Object.assign(db, updatedDb);
    this.addTradeLog({
      type: 'buy',
      school, stockName: stockname, quantity: n,
      price: p, totalCost: p * n, oldPrice,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync('./database.json', JSON.stringify(db));
    
    return { success: true, message: "Transaction successful", stocks: db.schooldata[schoolIndex].stocks[stockIndex] };
  }

  /*
    New Buying Formula:
Components:

Demand Ratio: stocksbought / totalStock - measures market saturation
Volume Impact: n / totalStock - measures trade size relative to company
Base Impact Rate: 0.5% to 2% based on demand
Volume Multiplier: Exponential impact for larger trades
Scarcity Multiplier: Higher prices when more stock is owned
Formula:

priceImpact = baseImpactRate × volumeMultiplier × scarcityMultiplier
newPrice = currentPrice × (1 + priceImpact)
    

New Selling Formula:
Components:

Supply Ratio: Remaining demand after sale
Volume Impact: Sale size relative to total stock
Base Decline Rate: 0.3% to 1.5% based on remaining demand
Volume Multiplier: Larger sales have more impact
Supply Multiplier: Prices drop faster with less demand
Selling Dampener: 0.7 multiplier (selling has less impact than buying)

    */

  sellStock(school, stockname, n) {
    const db = require('./database.json');
    const schoolIndex = db.schooldata.findIndex(
        (schoolData) => schoolData.schoolcode === school,
    );
    const stockIndex = db.schooldata[schoolIndex].stocks.findIndex(
        (stock, index) => stockname === db.stockprices[index].name,
    );
    
    // Check if the stock is suspended from trading
    if ((db.suspendedStocks || []).includes(stockname)) {
      return { success: false, message: `${stockname} is currently suspended from trading`, stocks: db.schooldata[schoolIndex].stocks[stockIndex] };
    }

    // Check if sufficient stocks are owned
    if (db.schooldata[schoolIndex].stocks[stockIndex] < n) {
      return { success: false, message: "Insufficient stocks owned", stocks: db.schooldata[schoolIndex].stocks[stockIndex] };
    }
    
    // Execute the transaction
    if(db.stockprices[stockIndex].lastBoughtBy===school){
      db.schooldata[schoolIndex].stocks[stockIndex] -= n;
      db.schooldata[schoolIndex].cash += (db.stockprices[stockIndex].lastBoughtPrice) * n;
      
      // Even for last buyer, apply price decrease to maintain market dynamics
      let p = Number(db.stockprices[stockIndex].price);
      const oldPrice = p;
      
      // Market supply increase (selling increases available supply)
      const supplyRatio = (db.stockprices[stockIndex].stocksbought - n) / db.stockprices[stockIndex].totalStock;
      
      // Volume impact (larger sales have more impact)
      const volumeImpact = n / db.stockprices[stockIndex].totalStock;
      
      // Base decline rate (starts at 0.3% for high demand stocks, up to 1.5% for low demand)
      const baseDeclineRate = 0.003 + ((1 - supplyRatio) * 0.012);
      
      // Volume multiplier (larger sales have more impact)
      const volumeMultiplier = 1 + Math.pow(volumeImpact * 100, 0.6);
      
      // Supply multiplier (prices drop faster when there's less demand)
      const supplyMultiplier = 1 + ((1 - supplyRatio) * 1.5);
      
      // Final impact calculation (selling has less impact than buying)
      const priceDecline = baseDeclineRate * volumeMultiplier * supplyMultiplier * 0.7;
      
      // Apply the price decrease
      p = parseFloat((p * (1 - priceDecline)).toFixed(2));
      
      // Ensure price doesn't go below a minimum threshold (10% of original value)
      const minPrice = 0.1 * Number(db.stockprices[stockIndex].lastBoughtPrice);
      if (p < minPrice) p = minPrice;
      
      db.stockprices[stockIndex].price = p.toFixed(2);
      
      // Update price history
      const updatedDb = this.updateStockPriceHistory(stockIndex, oldPrice, p);
      Object.assign(db, updatedDb);

      } else {
        db.schooldata[schoolIndex].stocks[stockIndex] -= n;
        db.schooldata[schoolIndex].cash += (db.stockprices[stockIndex].price) * n;
        
        // Calculate price decrease based on selling pressure
        let p = Number(db.stockprices[stockIndex].price);
        const oldPrice = p;
        
        // Market supply increase (selling increases available supply)
        const supplyRatio = (db.stockprices[stockIndex].stocksbought - n) / db.stockprices[stockIndex].totalStock;
        
        // Volume impact (larger sales have more impact)
        const volumeImpact = n / db.stockprices[stockIndex].totalStock;
        
        // Base decline rate (starts at 0.3% for high demand stocks, up to 1.5% for low demand)
        const baseDeclineRate = 0.003 + ((1 - supplyRatio) * 0.012);
        
        // Volume multiplier (larger sales have more impact)
        const volumeMultiplier = 1 + Math.pow(volumeImpact * 100, 0.6);
        
        // Supply multiplier (prices drop faster when there's less demand)
        const supplyMultiplier = 1 + ((1 - supplyRatio) * 1.5);
        
        // Final impact calculation (selling has less impact than buying)
        const priceDecline = baseDeclineRate * volumeMultiplier * supplyMultiplier * 0.7;
        
        // Apply the price decrease
        p = parseFloat((p * (1 - priceDecline)).toFixed(2));
        
        // Ensure price doesn't go below a minimum threshold (10% of original value)
        const minPrice = 0.1 * Number(db.stockprices[stockIndex].price);
        if (p < minPrice) p = minPrice;
        
        db.stockprices[stockIndex].price = p.toFixed(2);
        
        // Update price history
        const updatedDb = this.updateStockPriceHistory(stockIndex, oldPrice, p);
        // Update the db reference to the updated database
        Object.assign(db, updatedDb);
      }    // Update stocks bought counter (decrease when sold, making volume available again)
    if (!db.stockprices[stockIndex].stocksbought) {
      db.stockprices[stockIndex].stocksbought = 0;
    }
    db.stockprices[stockIndex].stocksbought -= n;
    
    // Ensure stocksbought doesn't go below 0
    if (db.stockprices[stockIndex].stocksbought < 0) {
      db.stockprices[stockIndex].stocksbought = 0;
    }
    
    this.addTradeLog({
      type: 'sell',
      school, stockName: stockname, quantity: n,
      price: Number(db.stockprices[stockIndex].price),
      totalValue: Number(db.stockprices[stockIndex].price) * n,
      timestamp: new Date().toISOString()
    });
    
    fs.writeFileSync('./database.json', JSON.stringify(db));
    
    return { success: true, message: "Transaction successful", stocks: db.schooldata[schoolIndex].stocks[stockIndex] };
  }
  getstockList() {
    const data = require('./database.json');
    return data.stockprices;
  }
  
  getStockPriceHistory(stockIndex = null) {
    const data = require('./database.json');
    
    // Initialize stockPriceHistory if it doesn't exist
    if (!data.stockPriceHistory) {
      data.stockPriceHistory = [];
      for(let i = 0; i < data.stockprices.length; i++) {
        data.stockPriceHistory.push([{
          price: data.stockprices[i].price,
          timestamp: new Date().toISOString(),
          change: 0
        }]);
      }
      fs.writeFileSync('./database.json', JSON.stringify(data));
    }
    
    if (stockIndex !== null) {
      return data.stockPriceHistory[stockIndex] || [];
    }
    
    return data.stockPriceHistory;
  }
  
  getAllStockData() {
    const data = require('./database.json');
    return {
      stockprices: data.stockprices,
      stockPriceHistory: this.getStockPriceHistory(),
      schooldata: data.schooldata
    };
  }
  setStockValue(i, prices) {
    const data = require('./database.json');
    data.stockprices[i].price = prices;
    fs.writeFileSync('./database.json', JSON.stringify(data));
  }
  setPrice(stock, price) {
    var data = require('./database.json');
    const stockObj = data.stockprices.find((i) => i.name === stock);
    const stockIndex = data.stockprices.findIndex((i) => i.name === stock);
    
    if (stockObj && stockIndex !== -1) {
      const oldPrice = parseFloat(stockObj.price);
      const newPrice = parseFloat(price);
      
      stockObj.price = price;
      stockObj.lastBoughtPrice = price;
      
      // Update price history
      const updatedDb = this.updateStockPriceHistory(stockIndex, oldPrice, newPrice);
      fs.writeFileSync('./database.json', JSON.stringify(updatedDb));
    } else {
      fs.writeFileSync('./database.json', JSON.stringify(data));
    }
  }
  resetDatabase() {
    fs.writeFileSync('./database.json', JSON.stringify(this.ogdb));
  }
  setAllPrices(which, arr) {
    var data = require('./database.json');
    data.allPrices[which] = arr;
    fs.writeFileSync('./database.json', JSON.stringify(data));
  }
  whitePrices() {
    var data = require('./database.json');
    data.whitePrices = !data.whitePrices;
    fs.writeFileSync('./database.json', JSON.stringify(data));
  }

  // Admin: update all stock prices by a percentage (e.g., +10 or -5)
  updatePricesByPercentage(percentChange) {
    const data = require('./database.json');
    const multiplier = 1 + percentChange / 100;
    for (let i = 0; i < data.stockprices.length; i++) {
      const oldPrice = parseFloat(data.stockprices[i].price);
      const newPrice = parseFloat((oldPrice * multiplier).toFixed(2));
      const updatedDb = this.updateStockPriceHistory(i, oldPrice, newPrice);
      Object.assign(data, updatedDb);
      data.stockprices[i].price = newPrice.toFixed(2);
      data.stockprices[i].lastBoughtPrice = newPrice.toFixed(2);
    }
    fs.writeFileSync('./database.json', JSON.stringify(data));
    return { success: true, message: `All prices updated by ${percentChange}%` };
  }

  // Admin: update a single stock's price by a percentage
  updatePriceByPercentage(stockName, percentChange) {
    const data = require('./database.json');
    const stockIndex = data.stockprices.findIndex(s => s.name === stockName);
    if (stockIndex === -1) return { success: false, message: 'Stock not found' };
    const multiplier = 1 + percentChange / 100;
    const oldPrice = parseFloat(data.stockprices[stockIndex].price);
    const newPrice = parseFloat((oldPrice * multiplier).toFixed(2));
    const updatedDb = this.updateStockPriceHistory(stockIndex, oldPrice, newPrice);
    Object.assign(data, updatedDb);
    data.stockprices[stockIndex].price = newPrice.toFixed(2);
    data.stockprices[stockIndex].lastBoughtPrice = newPrice.toFixed(2);
    fs.writeFileSync('./database.json', JSON.stringify(data));
    return { success: true, message: `${stockName} price updated by ${percentChange}%` };
  }

  // Admin: suspend a stock from trading
  suspendStock(stockName) {
    const data = require('./database.json');
    const stockIndex = data.stockprices.findIndex(s => s.name === stockName);
    if (stockIndex === -1) return { success: false, message: 'Stock not found' };
    if (!data.suspendedStocks) data.suspendedStocks = [];
    if (!data.suspendedStocks.includes(stockName)) data.suspendedStocks.push(stockName);
    fs.writeFileSync('./database.json', JSON.stringify(data));
    return { success: true, message: `${stockName} suspended from trading` };
  }

  // Admin: resume/lift a stock suspension
  resumeStock(stockName) {
    const data = require('./database.json');
    if (!data.suspendedStocks) data.suspendedStocks = [];
    data.suspendedStocks = data.suspendedStocks.filter(n => n !== stockName);
    fs.writeFileSync('./database.json', JSON.stringify(data));
    return { success: true, message: `${stockName} trading resumed` };
  }

  // IPO: compute clearing price and allocations from participant bids
  // bids: [{ team, price, shares }], supply: total shares on offer
  calculateIpoPrice(bids, supply) {
    if (!Array.isArray(bids) || bids.length === 0) {
      return { success: false, message: 'No bids entered' };
    }
    const valid = bids.filter(b => b && b.team && b.price > 0 && b.shares > 0);
    if (valid.length === 0) {
      return { success: false, message: 'No valid bids (need team, price and shares)' };
    }
    const sorted = valid.slice().sort((a, b) => b.price - a.price);
    let cumulative = 0;
    let clearingPrice = null;
    for (let i = 0; i < sorted.length; i++) {
      cumulative += sorted[i].shares;
      if (cumulative >= supply) {
        clearingPrice = sorted[i].price;
        break;
      }
    }
    if (clearingPrice === null) {
      return { success: false, message: `Total demand (${cumulative} shares) is less than supply (${supply} shares)` };
    }

    // Allocate: bids strictly above clearing get full shares; bids at clearing get pro-rata; below get nothing
    const above = sorted.filter(b => b.price > clearingPrice);
    const atPrice = sorted.filter(b => b.price === clearingPrice);
    const demandAbove = above.reduce((s, b) => s + b.shares, 0);
    const demandAt = atPrice.reduce((s, b) => s + b.shares, 0);
    let remaining = supply - demandAbove;
    if (remaining < 0) remaining = 0;

    const allocations = {};
    above.forEach(b => { allocations[b.team] = { price: clearingPrice, shares: b.shares }; });
    if (demandAt > 0) {
      const ratio = remaining / demandAt;
      atPrice.forEach(b => {
        allocations[b.team] = { price: clearingPrice, shares: Math.floor(b.shares * ratio) };
      });
    }

    return {
      success: true,
      clearingPrice,
      totalDemand: cumulative,
      demandAbove,
      demandAt,
      remaining,
      allocations
    };
  }

  // IPO: add the new stock to the exchange, allocate shares and charge teams
  launchIpo(name, supply, bids) {
    const result = this.calculateIpoPrice(bids, supply);
    if (!result.success) return result;
    const data = require('./database.json');
    if (data.stockprices.find(s => s.name === name)) {
      return { success: false, message: 'Stock already exists on the exchange' };
    }
    const price = result.clearingPrice;
    const stockIndex = data.stockprices.length;
    const stock = {
      name,
      price: price.toFixed(2),
      sector: "Aerospace and Defense",
      totalStock: supply,
      stocksbought: 0,
      lastBoughtBy: "",
      lastBoughtPrice: price.toFixed(2),
      lastBoughtQty: 0,
      stockPriceHistory: [price],
      risk: "extreme"
    };
    data.stockprices.push(stock);
    if (!data.stockPriceHistory) data.stockPriceHistory = [];
    data.stockPriceHistory.push([{ price, timestamp: new Date().toISOString(), change: 0 }]);
    if (!data.allPrices) data.allPrices = [];
    data.allPrices.push([price]);

    // Extend every team's holdings and allocate shares at the clearing price
    data.schooldata.forEach(school => { school.stocks.push(0); });
    let allocated = 0;
    Object.entries(result.allocations).forEach(([team, alloc]) => {
      const si = data.schooldata.findIndex(s => s.schoolcode === team);
      if (si !== -1 && alloc.shares > 0) {
        data.schooldata[si].stocks[stockIndex] += alloc.shares;
        data.schooldata[si].cash -= alloc.price * alloc.shares;
        allocated += alloc.shares;
      }
    });
    data.stockprices[stockIndex].stocksbought = allocated;

    this.addTradeLog({
      type: 'ipo',
      stockName: name, quantity: supply,
      price, timestamp: new Date().toISOString()
    });
    fs.writeFileSync('./database.json', JSON.stringify(data));
    return { success: true, message: `${name} IPO launched at ₹${price}`, stockIndex, clearingPrice: price };
  }

  // Admin: transfer shares from one team to another at a negotiated price
  transferShares(fromSchool, toSchool, stockName, quantity, negotiatedPrice) {
    const data = require('./database.json');
    const fromIdx = data.schooldata.findIndex(s => s.schoolcode === fromSchool);
    const toIdx = data.schooldata.findIndex(s => s.schoolcode === toSchool);
    if (fromIdx === -1) return { success: false, message: 'Source school not found' };
    if (toIdx === -1) return { success: false, message: 'Target school not found' };
    const stockIndex = data.stockprices.findIndex(s => s.name === stockName);
    if (stockIndex === -1) return { success: false, message: 'Stock not found' };
    if (data.schooldata[fromIdx].stocks[stockIndex] < quantity) {
      return { success: false, message: 'Insufficient shares in source team' };
    }
    const totalValue = negotiatedPrice * quantity;
    if (data.schooldata[toIdx].cash < totalValue) {
      return { success: false, message: 'Target team has insufficient cash' };
    }
    data.schooldata[fromIdx].stocks[stockIndex] -= quantity;
    data.schooldata[toIdx].stocks[stockIndex] += quantity;
    data.schooldata[fromIdx].cash += totalValue;
    data.schooldata[toIdx].cash -= totalValue;
    this.addTradeLog({
      type: 'transfer',
      fromSchool, toSchool, stockName, quantity,
      price: negotiatedPrice,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync('./database.json', JSON.stringify(data));
    return { success: true, message: 'Transfer successful' };
  }

  // User-to-user trade: create a trade offer
  createTradeOffer(fromSchool, toSchool, stockName, quantity, price) {
    const data = require('./database.json');
    if (!data.tradeOffers) data.tradeOffers = [];
    const offer = {
      id: makeid(12),
      fromSchool, toSchool, stockName, quantity, price,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    data.tradeOffers.push(offer);
    fs.writeFileSync('./database.json', JSON.stringify(data));
    return { success: true, offer };
  }

  // Accept a trade offer
  acceptTradeOffer(offerId) {
    const data = require('./database.json');
    if (!data.tradeOffers) return { success: false, message: 'No trade offers' };
    const offerIdx = data.tradeOffers.findIndex(o => o.id === offerId && o.status === 'pending');
    if (offerIdx === -1) return { success: false, message: 'Offer not found or already processed' };
    const offer = data.tradeOffers[offerIdx];
    const fromIdx = data.schooldata.findIndex(s => s.schoolcode === offer.fromSchool);
    const toIdx = data.schooldata.findIndex(s => s.schoolcode === offer.toSchool);
    const stockIndex = data.stockprices.findIndex(s => s.name === offer.stockName);
    if (fromIdx === -1 || toIdx === -1 || stockIndex === -1) {
      offer.status = 'failed';
      fs.writeFileSync('./database.json', JSON.stringify(data));
      return { success: false, message: 'School or stock not found' };
    }
    if ((data.suspendedStocks || []).includes(offer.stockName)) {
      offer.status = 'failed';
      fs.writeFileSync('./database.json', JSON.stringify(data));
      return { success: false, message: `${offer.stockName} is currently suspended from trading` };
    }
    if (data.schooldata[fromIdx].stocks[stockIndex] < offer.quantity) {
      offer.status = 'failed';
      fs.writeFileSync('./database.json', JSON.stringify(data));
      return { success: false, message: 'Insufficient shares' };
    }
    const totalValue = offer.price * offer.quantity;
    if (data.schooldata[toIdx].cash < totalValue) {
      offer.status = 'failed';
      fs.writeFileSync('./database.json', JSON.stringify(data));
      return { success: false, message: 'Insufficient cash' };
    }
    data.schooldata[fromIdx].stocks[stockIndex] -= offer.quantity;
    data.schooldata[toIdx].stocks[stockIndex] += offer.quantity;
    data.schooldata[fromIdx].cash += totalValue;
    data.schooldata[toIdx].cash -= totalValue;
    offer.status = 'completed';
    this.addTradeLog({
      type: 'user_trade',
      fromSchool: offer.fromSchool, toSchool: offer.toSchool,
      stockName: offer.stockName, quantity: offer.quantity,
      price: offer.price,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync('./database.json', JSON.stringify(data));
    return { success: true, message: 'Trade completed' };
  }

  // Market freeze: disable trading, calculate and store scoring snapshot
  marketFreeze() {
    const data = require('./database.json');
    data.tradetime = false;
    if (!data.freezeScores) data.freezeScores = [];
    const snapshot = this.calculateScores();
    snapshot.timestamp = new Date().toISOString();
    snapshot.freezeNumber = data.freezeScores.length + 1;
    data.freezeScores.push(snapshot);
    data.lastFreezeSnapshot = snapshot;
    fs.writeFileSync('./database.json', JSON.stringify(data));
    return snapshot;
  }

  // Market start: enable trading
  marketStart() {
    const data = require('./database.json');
    data.tradetime = true;
    fs.writeFileSync('./database.json', JSON.stringify(data));
    return { success: true, message: 'Market started' };
  }

  // Calculate scores: portfolio value (out of 25) + concentration (out of 5)
  calculateScores() {
    const data = require('./database.json');

    const teamScores = data.schooldata.map(school => {
      let totalFolioValue = school.cash;
      const holdings = {};
      school.stocks.forEach((qty, idx) => {
        if (qty > 0) {
          const val = qty * Number(data.stockprices[idx].price);
          totalFolioValue += val;
          holdings[data.stockprices[idx].name] = { qty, value: val, price: Number(data.stockprices[idx].price) };
        }
      });

      // Concentration (largest single company as % of folio value)
      let largestHoldingPct = 0;
      if (totalFolioValue > 0) {
        Object.values(holdings).forEach(h => {
          const pct = (h.value / totalFolioValue) * 100;
          if (pct > largestHoldingPct) largestHoldingPct = pct;
        });
      }
      let concentration = 5;
      if (largestHoldingPct > 60) concentration = 1;
      else if (largestHoldingPct > 50) concentration = 2;
      else if (largestHoldingPct > 40) concentration = 3;
      else if (largestHoldingPct > 30) concentration = 4;

      return {
        team: school.schoolcode,
        cash: school.cash,
        folioValue: totalFolioValue,
        holdings,
        concentration: { score: concentration, largestHoldingPct }
      };
    });

    // Sort by folioValue for portfolio value scoring (highest gets 25)
    teamScores.sort((a, b) => b.folioValue - a.folioValue);
    const highestFolio = teamScores.length > 0 ? teamScores[0].folioValue : 1;
    teamScores.forEach((t, idx) => {
      t.rank = idx + 1;
      t.portfolioValueScore = parseFloat(((t.folioValue / highestFolio) * 25).toFixed(2));
      t.freezeScore = parseFloat((t.portfolioValueScore + t.concentration.score).toFixed(2));
    });

    return { teams: teamScores, highestFolioValue: highestFolio };
  }

  // Get all freeze scores
  getFreezeScores() {
    const data = require('./database.json');
    return data.freezeScores || [];
  }

  // Get final scores (average of all freeze scores)
  getFinalScores() {
    const data = require('./database.json');
    const freezes = data.freezeScores || [];
    if (freezes.length === 0) return null;
    const teamMap = {};
    freezes.forEach(freeze => {
      freeze.teams.forEach(t => {
        if (!teamMap[t.team]) teamMap[t.team] = [];
        teamMap[t.team].push(t.freezeScore);
      });
    });
    const results = Object.entries(teamMap).map(([team, scores]) => {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      return { team, scores, average: parseFloat(avg.toFixed(2)) };
    });
    results.sort((a, b) => b.average - a.average);
    results.forEach((r, i) => r.rank = i + 1);
    return results;
  }

  addTradeLog(entry) {
    const data = require('./database.json');
    if (!data.tradeLog) data.tradeLog = [];
    data.tradeLog.push(entry);
    if (data.tradeLog.length > 500) data.tradeLog = data.tradeLog.slice(-500);
    fs.writeFileSync('./database.json', JSON.stringify(data));
  }

  getTradeLog() {
    const data = require('./database.json');
    return data.tradeLog || [];
  }
}
module.exports = {
  Database,
};