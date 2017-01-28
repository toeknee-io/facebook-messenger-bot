const fs = require('fs');
const _ = require('lodash');
const path = require('path');
const mmm = require('mmmagic');
const request = require('request');
const rp = require('request-promise');
const config = require('./config.json');
const utils = require('./lib/utils.js');
const moment = require('./lib/moment-extended.js');

const magic = new mmm.Magic(mmm.MAGIC_MIME);

const ENV = process.env.NODE_ENV;

const CREDENTIALS = utils.getCredentials();

const JERBONICS = [];
const addArtPending = [];

const DIR_ART = `${__dirname}/art`;
const DIR_GIF = `${__dirname}/gif`;

const REPLY_JERRY = ['No', 'In you own ass', 'Eff that', 'You have no crystal ball to predict history'];
const REPLY_BAD_CMD = [
  'No', 'In you own ass', 'Eff that', '¯\u005C_(ツ)_/¯',
  { sticker: '1057971357612846' },
  { attachment: fs.createReadStream(`${DIR_ART}/1.jpg`, 'utf8') },
];

let writeLock = false;
let artFiles = fs.readdirSync(DIR_ART, 'utf8');

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

    utils.debug(event);

    if (utils.isBot(event) || utils.isCooldown(event)) {
      return;
    }

    const senderName = _.findKey(config.facebook.userId,
      id => event.senderID === id || event.userID === id || event.reader === id);

    console.log(senderName !== 'bot'
      ? `[${event.threadID}] ${senderName}: ${event.body ? event.body : event.type}`
      : '');

    const cmd = utils.getCmd(event);
    const attachv = event.attachments;
    const toId = ENV !== 'development'
      ? event.threadID
      : config.facebook.userId.tony;

    if (senderName === 'jerry') {
      const msg = _.isArray(attachv) && attachv.length
        ? utils.getRandomFromArray(REPLY_BAD_CMD)
        : utils.getRandomFromArray(REPLY_JERRY);
      chat.sendMessage(msg, toId);
    } else if (utils.inArtQueue(addArtPending, event)
    && utils.canWrite(writeLock, attachv)) {
      writeLock = true;
      fs.readdir(DIR_ART, 'utf8', (readErr, files) => {
        request(attachv[0].previewUrl)
          .pipe(fs.createWriteStream(`${DIR_ART}/${files.length}.jpg`, 'utf8'))
          .on('close', () => {
            writeLock = false;
            addArtPending.splice(addArtPending.indexOf(event.senderID), 1);
            chat.sendMessage(`Art has been added at index ${files.length}`, toId);
            artFiles = fs.readdirSync(DIR_ART, 'utf8');
          });
      });
    } else if (cmd) {
      const subCmd = utils.getSubCmd(cmd, event);

      if (cmd === 'art') {
        if (subCmd) {
          if (subCmd === 'add') {
            addArtPending.push(event.senderID);
          } else if (subCmd === 'gallery') {
            const attachment = [];
            artFiles.forEach((file) => {
              const filePath = `${DIR_ART}/${file}`;
              magic.detectFile(filePath, (err, result) => {
                if (err) {
                  console.error(err);
                } else {
                  if (result.match(/jpeg|png/)) {
                    attachment.push(fs.createReadStream(filePath));
                  } else {
                    console.error(`invalid art type (${result}): ${filePath}`);
                    artFiles.splice(artFiles.indexOf(file), 1);
                    fs.unlink(filePath, (unlinkErr) => {
                      if (unlinkErr) {
                        console.error(`failed to deleted invalid art file: ${filePath}`);
                      }
                    });
                  }
                  if (attachment.length === artFiles.length) {
                    chat.sendMessage({ attachment }, toId);
                  }
                }
              });
            });
          } else if (subCmd === 'refresh') {
            let msg = 'Art has been refreshed:\u000A\u000A';

            artFiles = _.sortBy(fs.readdirSync(DIR_ART, 'utf8'), file => _.toNumber(file.replace('.jpg', '')));
            artFiles.forEach(artFile => (msg += `${artFile.replace('.jpg', '')}\u000A`));

            chat.sendMessage(msg, toId);
          } else if (subCmd === 'list') {
            artFiles.forEach(file =>
              chat.sendMessage(
                { body: file.replace('.jpg', ''), attachment: fs.createReadStream(`${DIR_ART}/${file}`) },
                event.senderID
              ));
          } else {
            const fileName = path.extname(subCmd) === '.jpg' ? subCmd : `${subCmd}.jpg`;
            const msg = artFiles.indexOf(fileName) > -1
              ? { attachment: fs.createReadStream(`${DIR_ART}/${fileName}`) }
              : utils.getRandomFromArray(REPLY_BAD_CMD);

            chat.sendMessage(msg, toId);
          }
        } else {
          const artFile = utils.getRandomFromArray(artFiles);

          chat.sendMessage({
            body: artFile.replace('.jpg', ''),
            attachment: fs.createReadStream(`${DIR_ART}/${artFile}`),
          }, toId);
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
        const kickId = config.facebook.userId[subCmd];
        if (senderName === 'tony' && kickId) {
          console.log(`kick: ${subCmd} (${kickId}) from ${event.threadID}`);
          chat.removeUserFromGroup(kickId, event.threadID);
        } else {
          chat.sendMessage(utils.getRandomFromArray(REPLY_BAD_CMD), toId);
        }
      }
      if (cmd === 'jerbonics') {
        if (subCmd === 'add') {
          JERBONICS.push(event.body.split('/jerbonics add')[1].trim());
        } else {
          chat.sendMessage(utils.getRandomFromArray(JERBONICS), toId);
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
        if (utils.hasWords(subCmd, 'leaderboard', 'score', 'scores')) {
          rp(opts).then(json =>
            chat.sendMessage(utils.getFanDuelLeaderboard(json), toId)
          ).catch(err => console.error(`[${cmd}] failed: ${err}`));
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
      if (cmd === 'gif') {
        const attachment = fs.createReadStream(`${DIR_GIF}/${subCmd}.gif`);
        attachment.once('error', () => chat.sendMessage(utils.getRandomFromArray(REPLY_BAD_CMD), toId));
        attachment.once('readable', () => chat.sendMessage({ attachment }, toId));
      }
      if (cmd === 'yoda') {
        if (subCmd) {
          const opts = {
            uri: 'https://yoda.p.mashape.com/yoda',
            qs: { sentence: subCmd },
            headers: {
              'X-Mashape-Key': 'EWMSPyqvN7msh0K6qhfZkUUT8OwNp1mzujujsnLI5gVc6qnGpi',
              accept: 'text/plain',
            },
          };
          rp(opts).then(res => chat.sendMessage(res, toId));
        } else {
          chat.sendMessage(utils.getRandomFromArray(REPLY_BAD_CMD), toId);
        }
      }
      if (cmd === 'joke') {
        rp('http://api.yomomma.info').then(res => chat.sendMessage(JSON.parse(res).joke, toId));
      }
    } else if (utils.hasWords(event, 'kevin', 'kvn', 'krvn')) {
      chat.sendMessage('Eff quitter kevin', toId);
    } else if (utils.hasWords(event, 'LGH', '🔥')) {
      chat.sendMessage([{ body: '🔥' },
        { attachment: fs.createReadStream(`${DIR_GIF}/tank.gif`) }][_.random(1)],
        toId
      );
    } else {
      const autoResponses = utils.getAutoResponses(event);
      utils.debug(autoResponses);
      if (!_.isEmpty(autoResponses)) {
        chat.sendMessage(utils.getRandomFromArray(autoResponses), toId);
      }
    }
  });

  process.on('exit', (code) => {
    console.log(`shutdown: exit code ${code}`);
    stopListening();
    console.log('shutdown: bot logged out');
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
