const fs = require('fs');
const _ = require('lodash');
const pm2 = require('pm2');
const path = require('path');
const request = require('request');
const express = require('express');
const mmm = require('mmmagic');
const rp = require('request-promise');
const EventEmitter = require('events');
const config = require('./config.json');
const pm2config = require('./pm2.config.js');
const utils = require('./lib/utils.js');
const bodyParser = require('body-parser');
const emojiRegex = require('emoji-regex');
// const moment = require('./lib/moment-extended.js');

const emitter = new EventEmitter();

const server = express();
const magic = new mmm.Magic(mmm.MAGIC_MIME);

const ENV = process.env.NODE_ENV;
const isDev = ENV === 'development';

const DIR_ART = `${__dirname}/art`;
const DIR_GIF = `${__dirname}/gif`;

// const credentials = utils.getCredentials();

const clients = {};
const addArtPending = [];

const userIds = config.facebook.userId;
const { tony: tonyId, jerry: jerryId, bot: botId, james: jamesId } = userIds;

const troll = [];
const untrollable = [tonyId, botId];


const kicked = [];

const replyBadCmd = [
  'No', 'In you own ass', 'Eff that', '¯\u005C_(ツ)_/¯',
  { sticker: '1057971357612846' },
  { attachment: fs.createReadStream(`${DIR_ART}/1.jpg`, 'utf8') },
];

let writeLock = false;
let remotePause = false;
let artFiles = fs.readdirSync(DIR_ART, 'utf8');

console.log('connecting to pm2 daemon');
pm2.connect(console.log);

process.on('SIGINT', () => {
  Object.values(clients).forEach((client) => {
    if (_.isFunction(client.logout)) {
      // console.log('logging out client', client);
      // client.logout();
    }
  });
});

process.on('exit', () => {
  console.log('disconnecting from pm2 daemon');
  pm2.disconnect();
});

process.on('uncaughtException', (err) => {
  console.log(`exiting due to uncaughtException: ${err}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, p) => {
  console.log('exiting due to unhandledRejection: Promise', p, 'reason', reason);
  process.exit(1);
});

const botLoginLock = `${config.chat.credentials.tonyBot.email}.lock`;
const botLocked = _.attempt(() => fs.readFileSync(botLoginLock));

if (!_.isError(botLocked)) {
  console.error('bot login locked, exiting', botLocked.toString());
  pm2.stop(pm2config.apps[0].name, console.error);
  process.exit(1);
}

const appState = _.attempt(() => JSON.parse(fs.readFileSync('appstate-bot.json', 'utf8')));
const creds = _.isError(appState) || typeof appState !== 'object' ? config.chat.credentials.tonyBot : { appState };

function addClient(chat, id) {
  clients[id] = chat;
  Object.assign(chat, { clients });
}

require('facebook-chat-api')(creds, (loginErr, chat) => {
  if (loginErr) {
    console.error(`creating login lock file ${botLoginLock}`);
    fs.writeFileSync(botLoginLock, JSON.stringify(loginErr, null, '\t'), 'utf8');
    pm2.stop(pm2config.apps[0].name, console.error);
    process.exit(1);
  }
  chat.setOptions(config.chat.options);

  fs.writeFileSync('appstate-bot.json', JSON.stringify(chat.getAppState()));

  // _.attempt(() => fs.unlink(botLoginLock, console.error));

  addClient(chat, botId);

  function sendMsg(msg, toId, cb = err => (err ? console.error(err) : false)) {
    return new Promise((resolve) => {
      let recipient = toId;
      if (isDev) {
        recipient = config.facebook.userId.tony;
        chat.sendMessage(`[DEBUG] ${JSON.stringify(msg)}`, recipient);
      } else {
        chat.sendMessage(msg, recipient, cb);
      }
      resolve();
    });
  }

  function kick(uid, tid) {
    return new Promise((resolve, reject) => {
      chat.removeUserFromGroup(uid, tid, (err) => {
        if (err) {
          reject(err);
        } else {
          kicked.push({ uid, tid });
          resolve();
        }
      });
    });
  }

  function addUser(uid, tid) {
    return new Promise((resolve, reject) => {
      if (utils.isBlockedThread(tid)) {
        reject(new Error(`Cannot addUser to blocked thread ${tid}`));
      } else {
        chat.addUserToGroup(uid, tid, (err) => {
          if (err) {
            reject(err);
          } else {
            _.remove(kicked, k => k.uid === uid);
            resolve(uid, tid);
          }
        });
      }
    });
  }

  function kickUserTemporary(userId, threadId, kickMsg, timeoutMs = 3600000) {
    if (_.isFinite(kickMsg)) {
      // eslint-disable-next-line no-param-reassign
      timeoutMs = kickMsg;
    } else if (_.isString(kickMsg) && !_.isEmpty(kickMsg)) {
      sendMsg(kickMsg, threadId);
    }

    kick(userId, threadId)
      .then(() =>
        setTimeout(() => emitter.emit('addUser', userId, threadId)
      , timeoutMs))
        .catch(console.error);
  }

  emitter.on('addUser', (uid, tid, msg = `Welcome back ${utils.getNameFromFbId(uid) || 'rando'}!`) => {
    addUser(uid, tid)
      .then(() => sendMsg(msg, tid))
      .catch(err => console.error(`failed to re-add kicked user ${uid}`, err));
  });

  // setInterval(() => utils.checkPresence(chat), 60000);

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

  const serverPort = _.toNumber(config.server.port);

  server.listen(isDev ? serverPort + 1 : serverPort, (err) => {
    const msg = `for http requests on port ${config.server.port}`;
    if (err) {
      console.error(`error attempting to listen ${msg}`);
    } else {
      console.log(`listening ${msg}`);
    }
  });

  chat.listen((listenErr, event) => {
    if (listenErr) {
      throw listenErr;
    }

    const eventType = utils.getType(event);

    utils.saveReaction(event);
    utils.avengeKickedAlly(chat, event);

    if (utils.isBot(event) || utils.isCooldown(event) || remotePause) {
      utils.debug(`skipping event: ${JSON.stringify(event)}\nisBot ${utils.isBot(event)} isCooldown ${utils.isCooldown(event)}`);
      return;
    }

    const { senderName,
      // messageID: mesId, threadID: thrId, body: b,
      threadID: thrId, body: b,
      attachments: attachv = [], senderID: sendId } = utils.assignEventProps(event);

    _.attempt(() => utils.logEvent(event));

    const lowB = _.toLower(b);
    const a0 = attachv[0] || {};

    const cmd = utils.getCmd(event);

    const toId = ENV !== 'development'
      ? thrId
      : tonyId;

    if (eventType === 'message_reaction' && !utils.isBot(event)) {
      // utils.getKickStats()
      //   .then((stats) => {
      //     const threadStats = stats[thrId];
      //     if (threadStats) {
      //       const count = threadStats[sendId] || 0;
      //       if (count <= -5) {
      //         const attachment = [fs.createReadStream(`${__dirname}/gif/reaction-kick.gif`)];
      //         chat.sendMessage({ attachment }, toId, () => kickUserTemporary(sendId, thrId));
      //       }
      //     }
      //   })
      //   .catch(console.error);
    }

    // const jerryRegex = /^[neut(ralize)?.*j(erry)?|ntj]/i;
    // const timerRegex = /for.*[0-9|a-zA-Z].*[seconds|minutes|hours]?/i;

    const regEx = /^(?:n(eutralize)?).*\b(?:j|jerbz?|jerry)\b|ntj/gi;
    if (regEx.test(lowB)) {
      const timeoutMs = utils.getKickTimeoutMs(lowB);
      kickUserTemporary(jerryId, thrId, timeoutMs > 86400000 ? 86400000 : timeoutMs);
    } else if (lowB === 'chinese to go' || lowB === 'enough' || lowB === 'enuff' || lowB === 'go eat a cat') {
      kickUserTemporary(jamesId, thrId);
    } else if (lowB === 'unfreeze the channel idiot' ||
    (eventType === 'photo' && (a0.width === 498 && a0.height === 250))) {
      kicked.forEach(({ u, t }) => {
        const name = utils.getNameFromFbId(sendId) || 'rando';
        addUser(u, t)
          .then(sendMsg(`rise wild ${name}`, t))
          .catch(console.error);
      });
    }
    if (lowB === 'rise wild jerry') {
      emitter.emit('addUser', jerryId, thrId);
    } else if (senderName === 'jerry' && _.endsWith(lowB, 'v')) {
      kickUserTemporary(jerryId, thrId, 'v ya later!', 5000);
    } else if (senderName === 'jerry' && _.endsWith(lowB, 'bitches')) {
      kickUserTemporary(jerryId, thrId, 'Who\'s the bitch now?!', 5000);
    } else if (senderName === 'jerry' && _.endsWith(lowB, 'in you ass')) {
      kickUserTemporary(jerryId, thrId, 'In you own ass', 5000);
    } else if (typeof b === 'string' && troll.includes(sendId)) {
      sendMsg(utils.getJerryReply(), toId);
    } else if (eventType === 'sticker' && a0.stickerID === '1224059264332534') {
      chat.sendMessage({ sticker: '1224059264332534' }, toId, err => console.error(err));
    } else if (senderName === 'steve' && typeof b === 'string'
    && (~b.toLowerCase().indexOf('heat') || ~b.toLowerCase().indexOf('bull')
    || ~b.indexOf('🐮'))) {
      chat.sendMessage('Eff Bull', toId);
    } else if (b && b.length <= 8
    && emojiRegex().test(b)) {
      let msg;
      if (b === '🔥') {
        msg = '🔥';
      } else if (b === '🐊') {
        msg = '🐊\u000A🐊\u000A🐊\u000A🐊\u000A🐊';
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
            addArtPending.splice(addArtPending.indexOf(sendId), 1);
            chat.sendMessage(`Art has been added at index ${files.length}`, toId);
            artFiles = fs.readdirSync(DIR_ART, 'utf8');
          });
      });
    } else if (cmd) {
      const subCmd = utils.getSubCmd(cmd, event);

      if (cmd === 'rankings') {
        let rankings = '';

        utils.getReactions().then((reactions) => {
          let results = [];

          Object.keys(reactions).forEach((senderId) => {
            const userReactions = reactions[senderId];
            const name = utils.getNameFromFbId(senderId) || senderId;

            let score = 0;

            userReactions.forEach((userReaction) => {
              if (_.isNumber(userReaction.reactionScore)) {
                score += userReaction.reactionScore;
              }
            });

            results.push({ name, score });
          });

          results = _.sortBy(results, ['score']).reverse();
          results.forEach((u) => { rankings += `${u.name}: ${u.score}\u000A`; });

          chat.sendMessage(rankings, toId);
        });
      } else if (cmd === 'art') {
        if (subCmd) {
          if (subCmd === 'add') {
            addArtPending.push(sendId);
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
                sendId
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
        if (senderName === 'tony' && kickId) {
          console.log(`kick: ${subCmd} (${kickId}) from ${thrId}`);
          chat.removeUserFromGroup(kickId, thrId);
        } else {
          chat.sendMessage(utils.getRandomFromArray(replyBadCmd), toId);
        }
      }
      if (cmd === 'jerbonics') {
        if (subCmd === 'add') {
          utils.saveJerrism(b.split('/jerbonics add')[1].trim());
        } else {
          chat.sendMessage(utils.getJerryReply(), toId);
        }
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
      if (cmd === 'joke') {
        rp('http://api.yomomma.info').then(res => chat.sendMessage(JSON.parse(res).joke, toId));
      }
      if (cmd === '8' && b.match(/\w\?/)) {
        rp(config['8ball'].api)
        .then(res => chat.sendMessage(res, toId));
      }
      if (cmd === 'troll') {
        const arg3 = _.words(b)[2];
        const ifn = utils.getFbIdFromName.bind(utils);

        let targetId = ifn(subCmd) || ifn(_.toLower(arg3)) || _.toNumber(arg3);
        let targetName = utils.getNameFromFbId(targetId) || 'rando';

        const targetIsTony = targetId === tonyId;
        const senderIsTony = sendId === tonyId;
        const targetImmune = untrollable.includes(targetId);
        const senderImmune = untrollable.includes(sendId);

        if (!arg3 || subCmd === 'add') {
          if ((targetIsTony || targetImmune) && !senderImmune) {
            targetId = sendId;
            targetName = utils.getNameFromFbId(targetId);
          }
          troll.push(targetId);
          sendMsg(`trolling ${targetName}`, thrId);
        } else if ((senderIsTony || senderImmune) && (subCmd === 'rm' || subCmd === 'remove')) {
          _.remove(troll, id => id === targetId);
          sendMsg(`no longer trolling ${targetName}`, thrId);
        } else if ((senderIsTony || senderImmune) && subCmd === 'whitelist') {
          _.remove(troll, id => id === targetId);
          untrollable.push(targetId);
          sendMsg(`${targetName} cannot be trolled`, thrId);
        } else if ((senderIsTony || senderImmune) && subCmd === 'unwhitelist') {
          if ((targetIsTony || targetImmune) && !senderImmune) {
            targetId = sendId;
            targetName = utils.getNameFromFbId(targetId);
          }
          _.remove(untrollable, id => id === targetId);
          sendMsg(`${targetName} can now be trolled`, thrId);
        }

        utils.debug(`cmdId: ${targetId}, targetImmune: ${targetImmune}, senderImmune: ${senderImmune}, untrollable: ${untrollable}, troll: ${troll}`);
      }
    } else if (utils.hasWords(event, 'LGH')) {
      chat.sendMessage({ body: '🔥' }, toId);
    } else if (b) {
      const autoResponses = utils.getAutoResponses(event);
      utils.debug(autoResponses);
      if (!_.isEmpty(autoResponses)) {
        sendMsg(utils.getRandomFromArray(autoResponses), toId);
      }
    }
  });
});

const tonyLoginLock = `${config.chat.credentials.tony.email}.lock`;
const tonyLocked = _.attempt(() => fs.readFileSync(tonyLoginLock));

if (!_.isError(tonyLocked)) {
  console.error('tony login locked, exiting', tonyLocked.toString());
  pm2.stop(pm2config.apps[0].name, console.error);
  process.exit(1);
}

require('facebook-chat-api')(config.chat.credentials.tony, (loginErr, chat) => {
  if (loginErr) {
    console.error(`creating login lock file ${tonyLoginLock}`);
    fs.writeFileSync(tonyLoginLock, JSON.stringify(loginErr, null, '\t'), 'utf8');
    pm2.stop(pm2config.apps[0].name, console.error);
    process.exit(1);
  }
  addClient(chat, tonyId);

  chat.setOptions({ listenEvents: true });

  let autoReply = false;

  chat.listen((listenErr, event) => {
    const { threadID: thrId, body: b, attachments: attachv = [],
    senderID: sendId } = utils.assignEventProps(event);

    _.attempt(() => utils.logEvent(event));

    utils.avengeKickedAlly(chat, event);

    if (sendId === tonyId) {
      if (_.toLower(b) === 'autopilot off') {
        autoReply = false;
      }
      if (_.toLower(b) === 'autopilot on') {
        autoReply = true;
      }
    }

    if (autoReply) {
      const eventType = utils.getType(event);
      const a0 = attachv[0] || {};

      if (eventType === 'sticker') {
        if (a0.stickerID === '1128766610602084') {
          chat.sendMessage({ sticker: '526120117519687' }, thrId, err => console.error(err));
        } else if (a0.stickerID === '1905753746341453') {
          chat.sendMessage({ sticker: '1905753633008131' }, thrId, err => console.error(err));
        }
      }
    }
  });

  // setInterval(() => utils.checkPresence(chat), 180000);
});
