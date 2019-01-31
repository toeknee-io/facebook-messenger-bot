/** @module utils */

const fs = require('fs');
const _ = require('lodash');
const emoji = require('node-emoji');
const Promise = require('bluebird');
const w2n = require('words-to-numbers').wordsToNumbers;
const config = require('../config.json');
const jerrisms = require('../data/jerrisms.json');
const fbStickers = require('../data/facebook-stickers.json');

const fsAsync = Promise.promisifyAll(require('fs'));

const userIds = config.facebook.userId;
const names = _.invert(userIds);

const PAUSE_TIMER = config.chat.PAUSE_MS;
const URL_API_FAN_DUEL = 'https://api.fanduel.com';
const APP_STATE_PATH = `${__dirname}/../app-state.json`;
const reactionsDir = `${__dirname}/../reactions`;
const kickStatsFile = `${__dirname}/../data/kick.json`;

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
  assignEventProps: (event, e = _.isObject(event) ? event : {}) => {
    const props = {
      senderName: _.findKey(config.facebook.userId,
        id => e.senderID === id || e.userID === id || e.reader === id)
        || e.senderID,
      eventType: self.getType(e),
    };
    _.assign(e, props);
    return _.isObject ? e : {};
  },
  prettyPrint: json =>
    JSON.stringify(json, null, '\t'),
  logEvent: (event) => {
    if (!event) {
      throw new Error('Cannot logEvent because event is undefined');
    }
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
        msg += type + (type === 'typ' ? ` (isTyping: ${event.isTyping} fromMobile: ${event.fromMobile})` : '');
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
  isBlockedThread: ({ threadID }) =>
    config.facebook.blockedThreadIds.indexOf(threadID) > -1,
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
  getNameFromFbId: id =>
    names[id],
  getFbIdFromName: name =>
    userIds[name],
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
   *  Checks if one of our allies has been removed from a facebook chat
   *
   *  @param    {object}  event  facebook event object
   *  @returns  {boolean}  true for allies, false if not
   */
  allyKicked: (event) => {
    if (!event) {
      return false;
    }

    const allies = [userIds.bot, userIds.tony];
    const kicked = _.get(event, 'logMessageData.leftParticipantFbId') || (event ? event.kicked : '');

    return event.logMessageType === 'log:unsubscribe' && _.isString(kicked) && allies.includes(kicked);
  },
  /**
   *  Avenge someone kicked from chat.
   *  Required event object props:
   *    threadId || threadID
   *    kicker || author
   *    kicked || logMessageData.leftParticipantFbId
   *
   *  @param    {object}  chat  facebook chat client
   *  @param    {object}  event  facebook event object
   */
  avengeKick: (chat, event) => {
    const threadId = event.threadId || event.threadID;

    const allies = [userIds.bot, userIds.tony];
    const kicker = event.kicker || event.author;
    const kicked = event.kicked || _.get(event, 'logMessageData.leftParticipantFbId');

    const botClient = chat.clients[userIds.bot] || chat;

    const avengerClient = kicked !== userIds.bot && botClient
      ? botClient : chat;
    const avengedClient = chat.clients[kicked] || chat;

    if (!threadId || !kicker || !kicked || !avengerClient) {
      console.warn(`could not avenge kick because one of threadId [${threadId}] kicker [${kicker}] kicked [${kicked}] is missing`);
    } else if (allies.includes(kicker)) {
      console.warn(`could not avenge kick because kicker [${kicker}] is an ally`);
    } else {
      console.log(`avenging kick (kicker: ${kicker}, kicked: ${kicked}) in thread ${threadId}`);

      avengerClient.addUserToGroup(kicked, threadId, (addUserErr) => {
        if (addUserErr) {
          console.error('addUserErr', addUserErr);
        } else {
          avengedClient.removeUserFromGroup(kicker, threadId, console.error);
        }
      });
    }
  },
  /**
   *  Checks if facebook event is for a kicked ally.  If it is,
   *  the ally is re-added to the thread and the kicker is kicked.
   *
   *  @param    {object}  chat  facebook chat client
   *  @param    {object}  event  facebook event
   */
  avengeKickedAlly: (chat, event) => {
    if (self.allyKicked(event)) {
      self.avengeKick(chat, event);
    }
  },
  /**
   *  Checks if a facebook user is present in a chat
   *
   *  @param    {Object}  Facebook chat object
   */
  checkPresence: (chat) => {
    const threadId = '1184034474942360'; // 1249856508434357
    self.debug('presence check');
    chat.getThreadInfo(threadId, (getThreadErr, threadInfo) => {
      if (getThreadErr) {
        console.error(`getThreadErr: ${getThreadErr}`);
      } else if (threadInfo) {
        try {
          const info = _.isArray(threadInfo) ? threadInfo[0] : threadInfo;
          self.debug(threadInfo);
          const pIds = info.participantIDs;
          const currentBotNick = info.nicknames[userIds.bot];
          const defaultBotNick = 'Bot';
          const jerryNick = info.nicknames[userIds.jerry];
          if (currentBotNick !== defaultBotNick) {
            console.log(`changing bot's nickname from ${currentBotNick} to ${defaultBotNick}`);
            chat.changeNickname(defaultBotNick, threadId, userIds.bot);
          }
          if (pIds.includes(userIds.jerry) && (!jerryNick || !~jerryNick.indexOf('Smelly') || ~jerryNick.toLowerCase().indexOf('tony'))) {
            let newJerryNick = (jerryNick ? `Smelly ${jerryNick}` : 'Smelly').replace(/tony/ig, '');
            const smellyCount = (newJerryNick.match(/smelly/ig) || []).length;
            self.debug(`smellyCount: ${smellyCount}`);
            if (smellyCount > 1) {
              newJerryNick = newJerryNick.replace(/smelly\s/i, '');
            }
            console.log(`changing jerry's nickname to ${newJerryNick}`);
            chat.changeNickname(newJerryNick, threadId, userIds.jerry);
          }
          if (pIds.indexOf(userIds.bot) === -1) {
            const opts = { threadId, kicker: userIds.jerry, kicked: userIds.bot };
            self.avengeKick(chat, opts);
          }
          if (pIds.indexOf(userIds.tony) === -1) {
            const opts = { threadId, kicker: userIds.jerry, kicked: userIds.tony };
            self.avengeKick(chat, opts);
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
    jerrisms.push({ jerrism, date: Date.now(), reply: true });
    fs.writeFile(`${__dirname}/../data/jerrisms.json`, self.prettyPrint(jerrisms));
  },
  getJerryReply: () =>
    self.getRandomFromArray(jerrisms).jerrism,
  getType: (event) => {
    if (event) {
      const hasAttachv = _.isArray(event.attachments);
      return hasAttachv && event.attachments[0]
        ? event.attachments[0].type
        : event.type;
    }

    return '';
  },
  saveReaction: event =>
    new Promise((resolve, reject) => {
      const eventType = self.getType(event);

      if (eventType === 'message_reaction' && event.senderID !== event.userID) {
        const userDir = `${__dirname}/../reactions/${event.senderID}`;

        fsAsync.lstatAsync(userDir).then(() => {
          const emojiObj = emoji.find(event.reaction);

          if (emojiObj) {
            const emojiKey = emojiObj.key;
            const reactionScore = config.facebook.reactionScore[emojiKey];

            Object.assign(event, { reactionScore });
            if (reactionScore < 0) {
              self.getKickStats().then((stats) => {
                const threadStats = stats[event.threadID] || {};
                const senderStat = threadStats[event.senderID] || 0;

                threadStats[event.senderID] = senderStat - 1;

                Object.assign(stats, { [event.threadID]: threadStats });

                fsAsync.writeFileAsync(kickStatsFile, self.prettyPrint(stats), 'utf8');
              });
            }
            return fsAsync.writeFileAsync(`${userDir}/${event.messageID}#${event.userID}.json`, self.prettyPrint(event), 'utf8');
          }

          return reject(new Error(`Could not find emoji for ${event.reaction}`));
        }).catch((err) => {
          if (err.code === 'ENOENT') {
            console.log(`creating new userDir: ${userDir}`);
            return fsAsync.mkdirAsync(userDir).then(() => self.saveReaction(event));
          }
          return reject(err);
        });
      }
      return resolve();
    }),
  getReactions: () =>
    new Promise((resolve, reject) => {
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
  getKickStats: () =>
    new Promise((resolve) => {
      fsAsync.readFileAsync(kickStatsFile)
        .then(json => resolve(_.isEmpty(json) ? {} : JSON.parse(json)))
        .catch((err) => {
          if (err.code === 'ENOENT') {
            resolve({});
          } else {
            console.error(err);
          }
        });
    }),
  readUserFile: (userDir, file) =>
    new Promise((resolve) => {
      fsAsync.readFileAsync(`${reactionsDir}/${userDir}/${file}`, 'utf8')
        .then(json => resolve(JSON.parse(json)))
        .catch(console.error);
    }),
  getKickTimeoutMs: (msg, defaultTimeoutMs = (1000 * 60) * 60) => {
    self.debug(`getKickTimeoutMs for msg: ${msg}`);

    const regex = 'for.*[0-9|a-zA-Z].*(seconds?|minutes?|hours?)?';

    let result = defaultTimeoutMs;

    try {
      const m = msg.match(regex);
      self.debug(`regEx match: ${m}`);
      const timerv = !_.isArray(m) || _.isEmpty(m) || !_.isString(m[0]) || _.isEmpty(m[0])
        ? ['for', '1', 'hour'] : m[0].trim().split(/\s/);

      Object.freeze(timerv);
      self.debug('timerv', timerv);

      const timeNum = self.getKickTimeNumber(timerv);
      const timeUnit = self.getKickTimeUnit(timerv);
      const multiplier = self.getKickTimeMultiplier(timeUnit);

      result = timeNum * multiplier;
      result = _.isNumber(result) && !_.isNaN(result) ? result : defaultTimeoutMs;

      self.debug(`getKickTimeoutMs parsed args: timerv [${timerv}] timeUnit [${timeUnit}] timeNum [${timeNum}] multiplier [${multiplier}]`);
    } catch (err) {
      result = defaultTimeoutMs;
      console.error(`getKickTimeoutMs err: ${err}`);
    }
    self.debug(`getKickTimeoutMs result: ${result}`);
    return result;
  },
  getKickTimeUnit: (timerv = ['for', '1', 'hour'], defaultTimeUnit = 'minute') => {
    let result = defaultTimeUnit;
    try {
      result = timerv[timerv.length - 1];
      if (_.isString(result) && result.endsWith('s')) {
        result = result.substring(0, result.lastIndexOf('s'));
      }
      result = ['second', 'minute', 'hour'].includes(result) ? result : defaultTimeUnit;
    } catch (err) {
      result = defaultTimeUnit;
      console.error(`getKickTimeUnit err: ${err}`);
    }
    self.debug(`getKickTimeUnit result: ${result}`);
    return result;
  },
  getKickTimeMultiplier: (timeUnit = 'minute', defaultTimeUnit = 'minute') => {
    const multipliers = {
      second: 1000,
      minute: 1000 * 60,
      hour: (1000 * 60) * 60,
    };
    const defaultMultiplier = multipliers[defaultTimeUnit];
    let result = null;
    try {
      result = multipliers[timeUnit] ? multipliers[timeUnit] : defaultMultiplier;
      result = _.isNumber(result) && !_.isNaN(result) ? result : defaultMultiplier;
    } catch (err) {
      result = defaultMultiplier;
      console.error(`getKickTimeMultiplier err: ${err}`);
    }
    self.debug(`getKickTimeMultiplier result: ${result}`);
    return result;
  },
  getKickTimeNumber: (timerv = ['for', '1', 'hour'], defaultTimeNumber = 1) => {
    let result = defaultTimeNumber;
    try {
      result = timerv
        .map((numStr) => {
          let num = _.toNumber(numStr);
          if (_.isString(numStr) && _.isNaN(num)) {
            num = w2n(numStr);
          }
          return !_.isNaN(num) && _.isNumber(num) ? num : numStr;
        })
        .map(Number);
      if (_.isArray(result)) {
        result = _.findLast(result, val => _.isFinite(val));
      }
    } catch (err) {
      result = defaultTimeNumber;
      console.error('getKickTimeNumber err:', err);
    }
    self.debug(`getKickTimeNumber result: ${result}`);
    return result;
  }
  ,
};
