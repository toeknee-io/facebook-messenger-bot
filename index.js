const fs = require('fs');
const _ = require('lodash');
const path = require('path');
const mmm = require('mmmagic');
const request = require('request');
const express = require('express');
const emoji = require('node-emoji');
const rp = require('request-promise');
const config = require('./config.json');
const utils = require('./lib/utils.js');
const bodyParser = require('body-parser');
const emojiRegex = require('emoji-regex');
const moment = require('./lib/moment-extended.js');

const server = express();
const magic = new mmm.Magic(mmm.MAGIC_MIME);

const ENV = process.env.NODE_ENV;
const DIR_ART = `${__dirname}/art`;
const DIR_GIF = `${__dirname}/gif`;

const credentials = utils.getCredentials();

const addArtPending = [];

const replyBadCmd = [
  'No', 'In you own ass', 'Eff that', '¯\u005C_(ツ)_/¯',
  { sticker: '1057971357612846' },
  { attachment: fs.createReadStream(`${DIR_ART}/1.jpg`, 'utf8') },
];

let writeLock = false;
let remotePause = false;
let artFiles = fs.readdirSync(DIR_ART, 'utf8');

require('facebook-chat-api')(credentials, (loginErr, chat) => {
  if (loginErr) {
    throw loginErr;
  }

  utils.writeAppState(chat.getAppState());
  chat.setOptions(config.chat.options);

  function sendMsg(msg, toId, cb) {
    let recipient = toId;
    if (ENV === 'development') {
      recipient = config.facebook.userId.tony;
      chat.sendMessage(`[DEBUG] ${JSON.stringify(msg)}`, recipient);
    }
    chat.sendMessage(msg, recipient, cb);
  }

  function kickUserTemporary(userId, threadId) {
    const nameFromId = utils.getNameFromFbId(userId);
    const name = nameFromId ? _.capitalize(nameFromId) : 'friend';
    sendMsg(`Timeout time ${name}!`, threadId);
    chat.removeUserFromGroup(userId, threadId);
    setTimeout(() => {
      chat.addUserToGroup(userId, threadId, (err) => {
        if (err) {
          console.error(`failed to re-add kicked user ${name} (${userId}): ${err}`);
        } else {
          sendMsg(`Welcome back ${name}!`, threadId);
        }
      });
    }, 3600000);
  }

  setInterval(() => utils.checkPresence(chat), 60000);

  server.use(bodyParser.json());
  server.use((req, res, next) => {
    Object.assign(req, { authKey: req.get('Authorization') });
    console.log(`[${req.ip}] ${req.method} ${req.originalUrl} authKey: ${req.authKey}`);
    res.set({ 'X-Powered-By': 'toeknee' });
    next();
  });

  server.post('/bot/facebook/message/send', (req, res) => {
    const authKey = config.server.authKey.message.send;
    const msg = req.body.message || req.body.msg;
    const toId = req.body.toId || req.body.threadId || req.body.threadID;
    const isAllowed = req.authKey === authKey && !_.isEmpty(msg) && !_.isEmpty(toId);
    if (isAllowed) {
      console.log(`[${req.ip}] sending msg: ${msg} toId: ${toId}`);
      sendMsg(msg, toId, (err) => {
        if (err) {
          console.error(`[${req.ip}] sendMsg err: ${err}`);
        }
        res.status(err ? 500 : 201).json({ result: err ? 'fail' : 'success' });
      });
    } else {
      console.error(`[${req.ip}] not allowed to send msg: ${msg} toId: ${toId} authKey: ${authKey}`);
      res.status(401).json({ result: 'fail' });
    }
  });

  server.post('/bot/facebook/message/pause', (req, res) => {
    const authKey = config.server.authKey.message.pause;
    const isAllowed = req.authKey === authKey;
    if (isAllowed) {
      remotePause = !remotePause;
      console.log(`[${req.ip}] remotePause set to: ${remotePause}`);
      res.status(201).json({ result: 'success', remotePause });
    } else {
      console.error(`[${req.ip}] not allowed to remote pause bot authKey: ${authKey}`);
      res.status(401).json({ result: 'fail' });
    }
  });

  server.listen(config.server.port, (err) => {
    const msg = `for http requests on port ${config.server.port}`;
    if (err) {
      console.error(`error attempting to listen ${msg}`);
    } else {
      console.log(`listening ${msg}`);
    }
  });

  const stopListening = chat.listen((listenErr, event) => {
    if (listenErr) {
      throw listenErr;
    }

    if (utils.isBot(event) || utils.isCooldown(event) || remotePause) {
      utils.debug(`skipping event: ${JSON.stringify(event)}
        isBot ${utils.isBot(event)} isCooldown ${utils.isCooldown(event)}`);
      return;
    }

    utils.assignEventProps(event);
    utils.logEvent(event);

    const cmd = utils.getCmd(event);
    const attachv = event.attachments;
    const toId = ENV !== 'development'
      ? event.threadID
      : config.facebook.userId.tony;

    if (event.senderName === 'jerry') {
      const msg = _.isArray(attachv) && attachv.length
        ? kickUserTemporary(config.facebook.userId.jerry, event.threadID)
        : utils.getJerryReply();
      chat.sendMessage(msg, toId);
    } else if (event.senderName === 'steve' && typeof event.body === 'string'
    && (~event.body.toLowerCase().indexOf('heat') || ~event.body.toLowerCase().indexOf('bull')
    || ~event.body.indexOf('🐮'))) {
      chat.sendMessage('Eff Bull', toId);
    } else if (event.body && event.body.length <= 8
    && emojiRegex().test(event.body)) {
      let msg;
      if (event.body === '🔥') {
        msg = '🔥';
      } else if (event.body === '🐊') {
        msg = '🐊\u000A🐊\u000A🐊\u000A🐊\u000A🐊';
      } else {
        msg = emoji.random().emoji;
      }
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
            artFiles.forEach(file => (msg += `${file.replace('.jpg', '')}\u000A`));

            chat.sendMessage(msg, toId);
          } else if (subCmd === 'list') {
            artFiles.forEach(file =>
              chat.sendMessage(
                { body: `/art ${file.replace('.jpg', '')}`, attachment: fs.createReadStream(`${DIR_ART}/${file}`) },
                event.senderID
              ));
          } else {
            const fileName = path.extname(subCmd) === '.jpg' ? subCmd : `${subCmd}.jpg`;
            const msg = artFiles.indexOf(fileName) > -1
              ? { attachment: fs.createReadStream(`${DIR_ART}/${fileName}`) }
              : utils.getRandomFromArray(replyBadCmd);

            chat.sendMessage(msg, toId);
          }
        } else {
          const file = utils.getRandomFromArray(artFiles);

          chat.sendMessage({
            body: `/art ${file.replace('.jpg', '')}`,
            attachment: fs.createReadStream(`${DIR_ART}/${file}`),
          }, toId);
        }
      }
      if (cmd === 'trump') {
        if (subCmd && (_.lowerCase(subCmd) === 'tony' || _.lowerCase(subCmd) === 'trump')) {
          chat.sendMessage(`${subCmd} is making bots great again`, toId);
        } else if (subCmd && (_.lowerCase(subCmd) === 'kevin' || _.lowerCase(subCmd) === 'kvn')) {
          chat.sendMessage(`${subCmd} has always been one of my biggest supporters!`, toId);
        } else {
          const opts = {
            uri: `${config.trump.api.uri}/${subCmd ? 'personalized' : 'random'}`,
            qs: { q: subCmd },
            json: true,
          };
          rp(opts).then((json) => {
            const msg = { body: `"${json.message}"`, attachment: fs.createReadStream(`${DIR_ART}/18.jpg`) };
            chat.sendMessage(msg, toId);
          }).catch(err => console.error(`trump err: ${err}`));
        }
      }
      if (cmd === 'kick') {
        const kickId = config.facebook.userId[subCmd];
        if (event.senderName === 'tony' && kickId) {
          console.log(`kick: ${subCmd} (${kickId}) from ${event.threadID}`);
          chat.removeUserFromGroup(kickId, event.threadID);
        } else {
          chat.sendMessage(utils.getRandomFromArray(replyBadCmd), toId);
        }
      }
      if (cmd === 'jerbonics') {
        if (subCmd === 'add') {
          utils.saveJerrism(event.body.split('/jerbonics add')[1].trim());
        } else {
          chat.sendMessage(utils.getJerryReply(), toId);
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
          }).catch(err => console.error(`fanduel info req failed: ${err}`));
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
        attachment.once('error', () => chat.sendMessage(utils.getRandomFromArray(replyBadCmd), toId));
        attachment.once('readable', () => chat.sendMessage({ attachment }, toId));
      }
      if (cmd === 'yoda') {
        if (subCmd) {
          const opts = _.assign(config.yoda.api, { qs: { sentence: subCmd } });
          rp(opts).then(res => chat.sendMessage(res, toId));
        } else {
          chat.sendMessage(utils.getRandomFromArray(replyBadCmd), toId);
        }
      }
      if (cmd === 'joke') {
        rp('http://api.yomomma.info').then(res => chat.sendMessage(JSON.parse(res).joke, toId));
      }
      if (cmd === '8' && event.body.match(/\w\?/)) {
        rp(config['8ball'].api)
        .then(res => chat.sendMessage(res, toId));
      }
    } else if (utils.hasWords(event, 'LGH')) {
      chat.sendMessage({ body: '🔥' }, toId);
    } else if (event.body) {
      const autoResponses = utils.getAutoResponses(event);
      utils.debug(autoResponses);
      if (!_.isEmpty(autoResponses)) {
        sendMsg(utils.getRandomFromArray(autoResponses), toId);
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

  setInterval(() => utils.checkPresence(chat), 90000);
});
