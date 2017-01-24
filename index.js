const fs = require('fs');
const _ = require('lodash');
const request = require('request');
const rp = require('request-promise');
const config = require('./config.json');
const utils = require('./lib/utils.js');
const moment = require('./lib/moment-extended.js');

const ENV = process.env.NODE_ENV;

const CREDENTIALS = utils.getCredentials();

const addArtPending = [];
const DIR_ART = `${__dirname}/art`;

const jerbonics = [];
const JERPLIES = ['No', 'In you own ass', 'You have no crystal ball to predict history', 'Eff that'];

let writeLock = false;

require('facebook-chat-api')(CREDENTIALS, (loginErr, chat) => {
  if (loginErr) {
    throw loginErr;
  }
  utils.writeAppState(chat.getAppState());
  chat.setOptions(config.chat.options);
  const stopListening = chat.listen((listenErr, event) => {
    if (listenErr) {
      throw listenErr;
    }
    console.log(event);
    if (utils.isntBot(event) && utils.isntCooldown(event)) {
      const toId = ENV !== 'development' ? event.threadID : config.facebook.userId.tony;
      const cmd = utils.getCmd(event);
      const attachv = event.attachments;

      if (event.senderID === config.facebook.userId.jerry) {
        let msg = JERPLIES[_.random(JERPLIES.length - 1)];
        if (_.isArray(attachv) && attachv.length) {
          msg = 'No';
        }
        chat.sendMessage(msg, event.threadID);
      } else if (addArtPending.indexOf(event.senderID) > -1
      && !writeLock && attachv[0] && attachv[0].previewUrl) {
        writeLock = true;
        fs.readdir(DIR_ART, 'utf8', (readErr, files) => {
          request(attachv[0].previewUrl)
            .pipe(fs.createWriteStream(`${DIR_ART}/${files.length}.jpg`, 'utf8'))
            .on('close', () => {
              writeLock = false;
              addArtPending.splice(addArtPending.indexOf(event.senderID), 1);
              chat.sendMessage('Art has been added', toId);
            });
        });
      } else if (cmd) {
        const subCmd = utils.getSubCmd(cmd, event);

        if (cmd === 'art') {
          if (subCmd === 'add') {
            addArtPending.push(event.senderID);
          } else {
            fs.readdir(DIR_ART, 'utf8', (readErr, files) => {
              if (readErr) {
                console.error(readErr);
              } else {
                const msg = {
                  attachment: fs.createReadStream(`${DIR_ART}/${files[_.random(files.length - 1)]}`),
                };
                chat.sendMessage(msg, toId);
              }
            });
          }
        }
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
            jerbonics.push(event.body.split('/jerbonics add')[1].trim());
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
              zip: `${subCmd || '97818'},us`,
              appid: config.weather.API_KEY,
            },
            json: true,
          };
          rp(opts).then(json => chat.sendMessage(utils.getWeather(json), toId));
        }
        if (cmd === 'shrug') {
          chat.sendMessage('¯\u005C_(ツ)_/¯', toId);
        }
      } else {
        const autoResponses = utils.getAutoResponses(event);
        if (autoResponses) {
          if (autoResponses.words.indexOf('duel') > -1
          || autoResponses.words.indexOf('fanduel') > -1) {
            chat.sendMessage('Make the duel great again', toId);
          } else if (autoResponses.words.indexOf('dat') > -1) {
            chat.sendMessage('dat dat', toId);
          } else if (autoResponses.phrases.indexOf('i am fenwick') > -1) {
            chat.sendMessage('hey fenwick, have you seen my shield?', toId);
          } else {
            chat.sendMessage({ sticker: '1057971357612846' }, toId);
          }
        }
      }
    }
  });

  process.on('exit', (code) => {
    console.log(`beginning shutdown: exit called with code [${code}]`);
    stopListening();
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
