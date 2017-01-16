const moment = module.exports = require('moment');

require('moment-precise-range-plugin');

Object.assign(moment, { formatPref: date => moment(date).format('MM-DD-YYYY') });
