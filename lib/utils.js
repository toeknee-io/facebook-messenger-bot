/** @module utils */

const fs = require('fs');
const _ = require('lodash');
const emoji = require('node-emoji');
const Promise = require('bluebird');
const config = require('../config.json');
const jerrisms = require('../data/jerrisms.json');
const fbStickers = require('../data/facebook-stickers.json');

const fsAsync = Promise.promisifyAll(require('fs'));

const PAUSE_TIMER = config.chat.PAUSE_MS;
const URL_API_FAN_DUEL = 'https://api.fanduel.com';
const APP_STATE_PATH = `${__dirname}/../app-state.json`;

const [AUTO_RESPONSE_PHRASES, AUTO_RESPONSE_WORDS, AUTO_RESPONSE_SPECIAL] = [[], [], []];

_.forEach(config.facebook.autoResponse,
  (res, str) => {
    if (str.match(/^:/) && str.length === 2) {
      AUTO_RESPONSE_SPECIAL.push(str);
    } else if (_.words(str).length === 1) {
      AUTO_RESPONSE_WORDS.push(str);
    } else {
      AUTO_RESPONSE_PHRASES.push(str);
    }
  }
);

let pausedUntil = Date.now();

const self = module.exports = {
  /**
   *  Gets Facebook login credentials from app-state.json file stored in
   *  the project's root directory, or from the config.json file
   *
   *  @returns  {Object}  An object containing facebook login credentials.
   */
  getCredentials: () => {
    const appState = self.readAppState();
    return !_.isError(appState) && typeof appState === 'object'
    ? { appState }
    : config.chat.credentials.bot;
  },
  readAppState: () =>
    _.attempt(() => JSON.parse(fs.readFileSync(APP_STATE_PATH, 'utf8'))),
  writeAppState: appState =>
    _.attempt(() =>
      fs.writeFileSync(APP_STATE_PATH, JSON.stringify(appState, null, '\t'), 'utf8')
    ),
  /**
   *  Prevents the bot from responding to any incoming messages
   *  for the amount of seconds passed in.
   *
   *  @param   {Number}  s  The number of seconds the bot will sleep for.
   */
  sleep: (s) => {
    const numSecs = _.toNumber(s);
    if (_.isNumber(numSecs)) {
      pausedUntil += (numSecs * 1000);
    }
  },
  assignEventProps: (event) => {
    const props = {
      senderName: _.findKey(config.facebook.userId,
        id => event.senderID === id || event.userID === id || event.reader === id)
        || event.senderID,
      eventType: self.getType(event),
    };
    _.assign(event, props);
  },
  prettyPrint: json =>
    JSON.stringify(json, null, '\t'),
  logEvent: (event) => {
    self.debug(event);
    if (self.isntBot) {
      const user = event.senderName ||
        self.getNameFromFbId(event.userID) || event.userID;
      let msg = `[${event.threadID}] ${user}: `;
      if (event.body) {
        msg += event.body;
      } else {
        let type = _.isArray(event.attachments) && event.attachments[0]
          ? event.attachments[0].type
          : event.type;
        if (type === 'sticker') {
          const stickerId = event.attachments[0].stickerID;
          type += ` (${event.attachments[0].stickerID})`;
          if (!fbStickers[stickerId]) {
            fbStickers[stickerId] = event.attachments[0];
            fs.writeFile(`${__dirname}/../data/facebook-stickers.json`,
              self.prettyPrint(fbStickers), 'utf8');
          }
        }
        msg += type;
      }
      console.log(msg);
    }
  },
  /**
   *  Checks if the Facebook event was created by the bot
   *
   *  @param    {Object}  Event  The facebook messenger event object.
   *  @returns  {Boolean}  True if bot, false if not.
   */
  isBot: (event) => {
    const botId = config.facebook.userId.bot;
    return event.senderID === botId
    || event.from === botId
    || event.author === botId
    || event.reader === botId
    || event.userID === botId;
  },
  isntBot: event =>
    !self.isBot(event),
  isCooldown: event =>
    !self.isntCooldown(event),
  isntCooldown: (event) => {
    const now = parseInt(event.timestamp, 10);
    if (now > pausedUntil) {
      pausedUntil = Date.now() + PAUSE_TIMER;
      return true;
    }
    return false;
  },
  isAllowedThread: ({ threadID }) =>
    config.facebook.threadIds.indexOf(threadID) > -1,
  inArtQueue: (queue, event) =>
    queue.indexOf(event.senderID) > -1,
  canWrite: (writeLock, attachv) =>
    !writeLock && attachv[0] && attachv[0].previewUrl,
  getWordsv: ({ body = '' }) =>
    _.words(body),
  hasWords: (container, ...words) => {
    let body = container;
    let match = 0;

    if (_.isObject(container)) {
      body = _.words(_.lowerCase(container.body));
    }
    words.forEach(word =>
      (match += body.indexOf(_.lowerCase(word)) > -1 ? 1 : 0)
    );
    return match > 0;
  },
  /**
   *  Uses the user's numeric facebook id to get
   *  the listed name for the user in config.facebook.userId
   *
   *  @param    {String}  facebookUserId  The user's numeric Facebook ID
   *  @returns  {String}  The user's name as listed in config.facebook.userId
   */
  getNameFromFbId: facebookUserId =>
    _.invert(config.facebook.userId)[facebookUserId],
  /**
   *  Gets the command (if there is one) in the message
   *
   *  @param   {Object}  event  The facebook messenger event object.
   *  @returns  {String|Undefined}  The commmand, or undefined if there is no command.
   *  @example
   *
   *  msg with command:
   *  /fanduel info
   *  // => 'fanduel'
   *
   *  msg with no command:
   *  hi there!
   *  // => undefined
   */
  getCmd: (event) => {
    let cmd;
    if (_.startsWith(event.body, '/')) {
      cmd = _.lowerCase(self.getWordsv(event)[0]);
      console.log(`cmd: ${cmd}`);
    }
    return cmd;
  },
  /**
   *  Gets the subcommand of a mesage
   *
   *  @param    {string}  cmd    The command in the message.
   *  @param    {Object}  event  The facebook messenger event object.
   *  @returns   {String}  The subcommand.
   *  @example
   *
   *  /fanduel info
   *  // => 'info'
   */
  getSubCmd: (cmd, event) => {
    const result = _.attempt(() => {
      const str = event.body.split(`/${cmd}`)[1];
      let subCmd;
      if (cmd === 'countdown') {
        subCmd = _.camelCase(str);
      } else if (cmd === 'yoda' || cmd === 'gif') {
        subCmd = str.trim();
      } else {
        subCmd = _.lowerCase(_.words(event.body)[1]);
      }
      console.log(`subCmd: ${subCmd}`);
      return subCmd;
    });
    if (_.isError(result)) {
      console.error(`failed to getSubCmd from: ${event.body}`);
    }
    return result;
  },
  /**
   *  Retrieves a random element from an array.
   *
   *  @param   {Array}  [array=[]]  The array that contains the random element.
   *  @returns  {*}  The randomly retrieved element.
   */
  getRandomFromArray: (array = []) =>
    array[_.random(array.length - 1)],
  /**
   *  Adds possible auto response replies to the matches object
   *
   *  @param {Object} event   [description]
   *  @returns {void}
   */
  addAutoResponseMatch: ({ matches, autoResv, body, type }) => {
    if (body) {
      self.debug(`auto response type: ${type}`);
      autoResv.forEach((str) => {
        const conf = config.facebook.autoResponse[str];
        const match = body.match(new RegExp(conf.regEx, 'i'));
        if (match) {
          matches[type].push(config.facebook.autoResponse[str].response);
        }
      });
    }
  },
  /**
   *  Gets possible auto responses for a facebook message
   *
   *  @param {Object} event [event] The facebook event to check for possible
   *  auto responses
   *
   *  @param {String} event.body The body (message) of the event
   *  @returns {Array} An object with words and phrases props, or undefined
   */
  getAutoResponses: (event) => {
    const body = event.body;
    const matches = { words: [], phrases: [], special: [] };

    self.debug(`checking for auto response in body ${body}`);

    self.addAutoResponseMatch({
      matches, autoResv: AUTO_RESPONSE_SPECIAL, body, type: 'special',
    });
    self.addAutoResponseMatch({
      matches, autoResv: AUTO_RESPONSE_PHRASES, body: body.toLowerCase(), type: 'phrases',
    });
    self.addAutoResponseMatch({
      matches, autoResv: AUTO_RESPONSE_WORDS, body: body.toLowerCase(), type: 'words',
    });

    self.debug(matches);

    return _.concat(matches.words, matches.phrases, matches.special);
  },
/**
 *  [getFanDuelBaseUrl description]
 *
 *  @param    {[type]}  event  [description]
 *  @returns  {string}  The Base URL for a FanDuel API call.
 */
  getFanDuelBaseUrl: (event) => {
    const cmdArray = event.body.split(/\s/);
    if (cmdArray.length === 3) {
      const contestId = cmdArray.splice(1)[1];
      if (contestId && (contestId.indexOf('-') > -1)) {
        config.fanDuel.contest.id = contestId;
        // fs.writeFileSync('../config.json', JSON.stringify(config, null, '\t'), 'utf8');
      }
    }
    return `${URL_API_FAN_DUEL}/contests/${config.fanDuel.contest.id}`;
  },
  getFanDuelRankChar: (rank) => {
    if (rank === 1) {
      return '\ud83c\udfc6';
    }
    return `[${rank}]`;
  },
  /**
   *  Takes JSON response from FanDuel and turns it into a string that
   *  can be sent back as a message.
   *
   *  @param    {Object}  json  JSON response returned from FanDuel.
   *  @returns  {String}  A stringified leaderboard to send as a chat message.
   */
  getFanDuelLeaderboard: (json) => {
    const scores = [];
    json.rosters.forEach((roster) => {
      const result = {};
      /* eslint-disable no-underscore-dangle */
      const userId = roster._url.split(`${URL_API_FAN_DUEL}/users/`)[1].split('/')[0];
      /* eslint-enable no-underscore-dangle */
      result.user = config.fanDuel.userIdToName[userId];
      result.score = roster.score;
      result.ppr = roster.ppr;
      scores.push(result);
    });
    let msg = `${json.contests[0].name}\u000A--\u000A`;
    const results = _.orderBy(scores, 'score', 'desc');
    let rank = 0;
    results.forEach((result) => {
      const msgRank = self.getFanDuelRankChar(rank += 1);
      msg += `${msgRank} ${result.user}: ${result.score} (${result.ppr})\u000A`;
    });
    return msg;
  },
  /**
   *  Checks if a facebook user is present in a chat
   *
   *  @param    {Object}  Facebook chat object
   */
  checkPresence: (chat) => {
    const threadId = '1184034474942360'; // 1249856508434357
    self.debug('presence check');
    chat.getThreadInfo(threadId, (getThreadErr, info) => {
      if (getThreadErr) {
        console.error(`getThreadErr: ${getThreadErr}`);
      } else if (info) {
        try {
          self.debug(info);
          const userIds = config.facebook.userId;
          const pIds = info.participantIDs;
          const currentBotNick = info.nicknames[userIds.bot];
          const defaultBotNick = 'Bot';
          const jerryNick = info.nicknames[userIds.jerry];
          if (currentBotNick !== defaultBotNick) {
            console.log(`changing bot's nickname from ${currentBotNick} to ${defaultBotNick}`);
            chat.changeNickname(defaultBotNick, threadId, userIds.bot);
          }
          if (pIds.includes(userIds.jerry) && (!jerryNick || !~jerryNick.indexOf('Smelly'))) {
            const newJerryNick = jerryNick ? `Smelly ${jerryNick}` : 'Smelly';
            console.log(`changing jerry's nickname to ${newJerryNick}`);
            chat.changeNickname(newJerryNick, threadId, userIds.jerry);
          }
          if (pIds.indexOf(userIds.bot) === -1) {
            console.log(`re-adding bot for ${threadId}`);
            chat.addUserToGroup(userIds.bot, threadId);
          }
          if (pIds.indexOf(userIds.tony) === -1) {
            console.log(`re-adding tony for ${threadId}`);
            chat.addUserToGroup(userIds.tony, threadId);
          }
        } catch (err) {
          console.error(`checkPresence.err: ${err}`);
        }
      }
    });
  },
  getWeather: json =>
    `Weather in ${json.name}\u000AHumidity: ${json.main.humidity}\u000ACurrent Temp: ${json.main.temp} (${json.weather[0].main})\u000AHigh/Low Temp: ${json.main.temp_max}/${json.main.temp_min}`,
  debug: (msg) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEBUG] ${_.isObject(msg) ? JSON.stringify(msg) : msg}`);
    }
  },
  saveJerrism: (jerrism) => {
    jerrisms.push({ jerrism, date: Date.now(), reply: false });
    fs.writeFile(`${__dirname}/../data/jerrisms.json`, self.prettyPrint(jerrisms));
  },
  getJerryReply: () =>
    self.getRandomFromArray(jerrisms).jerrism,
  getType: (event) => {
    const hasAttachv = _.isArray(event.attachments);
    return hasAttachv && event.attachments[0]
      ? event.attachments[0].type
      : event.type;
  },
  saveReaction: event =>
    new Promise((resolve, reject) => {
      const userDir = `${__dirname}/../reactions/${event.senderID}`;

      fsAsync.lstatAsync(userDir).then(() => {
        const emojiObj = emoji.find(event.reaction);

        if (emojiObj) {
          const emojiKey = emojiObj.key;
          const reactionScore = config.facebook.reactionScore[emojiKey];

          Object.assign(event, { reactionScore });

          fsAsync.writeFileAsync(`${userDir}/${event.messageID}.json`, self.prettyPrint(event), 'utf8');
        }
      }).catch((err) => {
        if (err.code === 'ENOENT') {
          console.log(`creating new userDir: ${userDir}`);
          fsAsync.mkdirAsync(userDir).then(() => self.saveReaction(event));
        } else {
          reject(err);
        }
      });
    }),
  getReactions: () =>
    new Promise((resolve, reject) => {
      const reactionsDir = `${__dirname}/../reactions`;

      fsAsync.lstatAsync(reactionsDir)
        .then((stats) => {
          if (stats.isDirectory()) {
            fsAsync.readdirAsync(reactionsDir).then((userDirs) => {
              if (_.isArray(userDirs)) {
                const promises = [];
                userDirs.forEach((userDir) => {
                  promises.push(self.readUserDir(userDir));
                });
                Promise.all(promises).then((reactions) => {
                  const result = {};
                  reactions.forEach((reaction) => {
                    Object.assign(result, reaction);
                  });
                  resolve(result);
                });
              }
            });
          }
        }).catch(reject);
    }),
  readUserDir: userDir =>
    new Promise((resolve) => {
      const result = {};
      const promises = [];
      const reactionsDir = `${__dirname}/../reactions`;

      result[userDir] = [];

      fsAsync.readdirAsync(`${reactionsDir}/${userDir}`).then((files) => {
        files.forEach((file) => {
          promises.push(self.readUserFile(userDir, file).then(json => result[userDir].push(json)));
        });
        Promise.all(promises).then(() => {
          resolve(result);
        });
      });
    }),
  readUserFile: (userDir, file) =>
    new Promise((resolve) => {
      const reactionsDir = `${__dirname}/../reactions`;
      fsAsync.readFileAsync(`${reactionsDir}/${userDir}/${file}`, 'utf8')
        .then(json => resolve(JSON.parse(json)));
    })
  ,
};
