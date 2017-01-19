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
  : config.chat.credentials.bot;

const jerbonics = ['No', 'In you own ass'];
require('facebook-chat-api')(credentials, (loginErr, chat) => {
  if (loginErr) {
    throw loginErr;
  }

  utils.writeAppState(chat.getAppState());
  chat.setOptions(config.chat.options);
  const stopListening = chat.listen((listenErr, event) => {
    if (listenErr) {
      throw listenErr;
    }

    console.log('event: %j', event);

    if (utils.isntBot(event) && utils.isntCooldown(event)) {
      const toId = event.threadID;
      const cmd = utils.getCmd(event);

      if (event.senderID === config.facebook.userId.jerry) {
        chat.sendMessage(jerbonics[_.random(jerbonics.length - 1)], event.threadID);
      } else if (cmd) {
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
      } else {
        const autoResponses = utils.getAutoResponses(event);
        console.log('possible autoResponses: %j', autoResponses);
        if (autoResponses) {
          chat.sendMessage({ sticker: '1057971357612846' }, event.threadID);
        }
      }
    }
  });

  process.on('exit', (code) => {
    console.log(`beginning shutdown: exit called with code [${code}]`);
    stopListening();
    chat.logout();
    console.log('bot logged out.');
  });
});

require('facebook-chat-api')(config.chat.credentials.tony, (loginErr, chat) => {
  if (loginErr) {
    throw loginErr;
  }
  chat.setOptions(config.chat.options);
  chat.listen((listenErr) => {
    if (listenErr) {
      throw listenErr;
    }
  });
});
