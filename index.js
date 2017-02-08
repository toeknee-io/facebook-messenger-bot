const fs = require('fs');
const _ = require('lodash');
const request = require('request');
const cmd = require('./lib/cmd.js');
const emoji = require('node-emoji');
const config = require('./config.json');
const utils = require('./lib/utils.js');
const stickers = require('./data/facebook-stickers.json');

const ENV = process.env.NODE_ENV;
const DIR_ART = `${__dirname}/art`;
const DIR_GIF = `${__dirname}/gif`;

const credentials = utils.getCredentials();
const badCmdRes = [
  'No', 'In you own ass', 'Eff that', '¯\u005C_(ツ)_/¯',
  { sticker: '1057971357612846' },
  { attachment: fs.createReadStream(`${DIR_ART}/1.jpg`, 'utf8') },
];

let intervalId;
let writeLock = false;

utils.login(credentials).then((chat) => {
  function resetRandom() {
    clearInterval(intervalId);
    intervalId = setInterval(() => doRandom(), 5000);
  }
    
  function doRandom() {
    resetRandom();

    const i = _.random(2);

    let msg;

    if (i === 0) {
      msg = utils.getRandomFromArray(badCmdRes);
    } else if (i === 1) {
      const stickersv = _.toArray(stickers);
      const idx = _.random(stickersv.length - 1);
      msg = { sticker: stickersv[idx].stickerID };
    } else {
      const artFiles = utils.getArtFiles();
      console.dir(artFiles);
      const idx = _.random(artFiles.length - 1);
      msg = { attachment: fs.createReadStream(`${DIR_ART}/${utils.getArtFiles()[idx]}`, 'utf8') };
    }

    chat.sendMsg(msg, '1184034474942360');
  }

  const stopListening = chat.listen((listenErr, event) => {
    if (listenErr) {
      throw listenErr;
    }

    const isMsg = event.type === 'message';

    resetRandom();
    utils.logEvent(event);

    if (utils.isBot(event) || utils.isCooldown(event) || !isMsg) {
      utils.debug(`skipping event: ${JSON.stringify(event)}
        isBot ${utils.isBot(event)} isCooldown ${utils.isCooldown(event)}`);
      return;
    }

    utils.assignEventProps(event);

    const toId = ENV !== 'development'
      ? event.threadID
      : config.facebook.userId.tony;

    if (event.senderName === 'jerry') {
      const msg = event.attachv.length
        ? utils.getRandomFromArray(badCmdRes)
        : utils.getJerryReply();
      chat.sendMsg(msg, toId);
    } else if (utils.isSaveArtEvent(writeLock, event)) {
      writeLock = true;
      fs.readdir(DIR_ART, 'utf8', (readErr, files) => {
        request(event.attachv[0].previewUrl)
         .pipe(fs.createWriteStream(`${DIR_ART}/${files.length}.jpg`, 'utf8'))
         .on('close', () => {
           writeLock = false;
           utils.rmArtQueue(event);
           chat.sendMsg(`Art has been added at index ${files.length}`, toId);
           utils.setArtFiles(fs.readdirSync(DIR_ART, 'utf8'));
         });
      });
    } else if (utils.isEmoji(event)) {
      const msg = event.body === '🔥' ? '🔥' : emoji.random();
      chat.sendMsg(msg, toId);
    } else if (event.cmd) {
      cmd(chat, event);
    } else if (utils.hasWords(event, 'LGH')) {
      chat.sendMsg([{ body: '🔥' },
        { attachment: fs.createReadStream(`${DIR_GIF}/tank.gif`) }][_.random(1)],
        toId
      );
    } else {
      const autoResponses = utils.getAutoResponses(event);
      utils.debug(autoResponses);
      if (!_.isEmpty(autoResponses)) {
        chat.sendMsg(utils.getRandomFromArray(autoResponses), toId);
      }
    }
  });

  process.on('exit', (code) => {
    console.log(`shutdown: exit code ${code}`);
    stopListening();
    console.log('shutdown: bot logged out');
  });
}).catch(err => console.error(`failed to login: ${err}`));
