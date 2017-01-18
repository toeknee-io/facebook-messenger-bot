/* TO-DO
  parse cmds less dumbly
  send msgs less dumbly
  automate getting fanduel auth header
  automate getting/setting fanduel contestId
*/

const _ = require('lodash');
const rp = require('request-promise');
const config = require('./config.json');
const utils = require('./lib/utils.js');
const moment = require('./lib/moment-wrapped.js');

const appState = utils.readAppState();
const credentials = !_.isError(appState) && typeof appState === 'object'
  ? { appState }
  : config.chat.credentials.tonyBot;

const jerbonics = ['No', 'In you own ass'];

require('facebook-chat-api')(credentials, (loginErr, chat) => {
  if (loginErr) {
    throw loginErr;
  }

  utils.writeAppState(chat.getAppState());
  setInterval(utils.checkPresence, 1000, chat);

  chat.setOptions(config.chat.options);
  chat.listen((listenErr, event) => {
    if (listenErr) {
      throw listenErr;
    }
    const body = event.body;
    const cmd = utils.getCmd(body);

    console.log('event: %j', event);

    if (event.senderID === config.facebook.userId.jerry) {
      chat.sendMessage(jerbonics[_.random(jerbonics.length - 1)], event.threadID);
    } else if (utils.canAutoRespond(event, 'no')) {
      chat.sendMessage('No', event.threadID);
    } else if (utils.canAutoRespond(event, 'eff bot')) {
      chat.sendMessage('eff you', event.threadID);
    }/* else if (body && _.intersection(_.words(_.lowerCase(body)),
      ['kevin', 'kvn', 'krvn', 'fenwick']).length
      && config.facebook.threadIds.indexOf(event.threadID) > -1
      && event.senderID !== config.facebook.userId.tonyBot) {
      chat.sendMessage('eff kevin', event.threadID);
    }*/
    if (cmd === 'sleep' && event.senderID === config.facebook.userId.tony) {
      utils.sleep(_.words(body)[1]);
    }

    if (utils.canRespond(cmd, event)) {
      const toId = event.threadID;
      const subCmd = utils.getSubCmd(cmd, event);

      if (cmd === 'trump') {
        if (subCmd && (_.lowerCase(subCmd) === 'tony' || _.lowerCase(subCmd) === 'trump')) {
          chat.sendMessage(`${subCmd} is making bots great again`, toId);
        } else {
          const opts = {
            uri: 'https://api.whatdoestrumpthink.com/api/v1/quotes/random',
            json: true,
          };
          if (subCmd) {
            opts.uri = 'https://api.whatdoestrumpthink.com/api/v1/quotes/personalized';
            opts.qs = { q: subCmd };
          }
          rp(opts).then(json => chat.sendMessage(json.message, toId));
        }
      }
      if (cmd === 'kick') {
        if (event.senderID === config.facebook.userId.tony) {
          const kickId = config.facebook.userId[subCmd];
          if (kickId) {
            console.log(`[${cmd}] kicking ${subCmd} (${kickId}) from ${event.threadID}`);
            chat.removeUserFromGroup(kickId, event.threadID);
          } else {
            chat.sendMessage('I don\'t know who that is', toId);
          }
        } else {
          chat.sendMessage('No', toId);
        }
      }
      if (cmd === 'jerbonics') {
        if (subCmd === 'add') {
          jerbonics.push(_.lowerCase(event.body.split('/jerbonics add')[1].trim()));
        } else {
          chat.sendMessage(jerbonics[_.random(jerbonics.length - 1)], toId);
        }
      }
      if (cmd === 'fanduel') {
        const baseUrl = utils.getFanDuelBaseUrl(event);
        const opts = {
          uri: subCmd === 'info' ? baseUrl : `${baseUrl}/entries?page=1&page_size=10`,
          headers: config.fanDuel.authHeader,
          json: true,
        };
        if (subCmd === 'info') {
          rp(opts).then((json) => {
            const contest = json.contests[0];
            const entered = contest.entries.count;
            const startDate = contest.start_date;
            const msg = `${contest.name}\u000A--\u000AID: ${contest.id}\u000AEntered: ${entered}/${contest.size.min}\u000AStarts In: ${moment().tz('America/New_York').preciseDiff(moment(startDate).tz('America/New_York'))}`;
            chat.sendMessage(msg, toId);
          }).catch(err => console.error(`[${cmd}] failed: ${err}`));
        }
        if (subCmd === 'leaderboard' || subCmd === 'score' || subCmd === 'scores') {
          rp(opts).then((json) => {
            const leaderboard = utils.getFanDuelLeaderboard(json);
            chat.sendMessage(leaderboard, toId);
          }).catch(err => console.error(`[${cmd}] failed: ${err}`));
        }
      }
      if (cmd === 'countdown') {
        const endDate = config.cooldown.endDate[subCmd];
        const diff = moment().preciseDiff(moment(endDate));
        chat.sendMessage(`${_.lowerCase(subCmd)} (${moment.formatPref(endDate)})\u000A${diff}`, toId);
      }
      if (cmd === 'weather') {
        const opts = {
          uri: 'http://api.openweathermap.org/data/2.5/weather',
          qs: {
            units: 'imperial',
            zip: `${subCmd},us`,
            appid: config.weather.API_KEY,
          },
          json: true,
        };
        rp(opts).then(json => chat.sendMessage(utils.getWeather(json), toId));
      }
    }
  });
});

require('facebook-chat-api')(config.chat.credentials.tony, (loginErr, chat) => {
  if (loginErr) {
    throw loginErr;
  }
  chat.setOptions(config.chat.options);
  setInterval(utils.checkPresence, 1000, chat);
  chat.listen((listenErr) => {
    if (listenErr) {
      throw listenErr;
    }
  });
});
