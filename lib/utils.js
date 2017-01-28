/** @module utils */

const fs = require('fs');
const _ = require('lodash');
const config = require('../config.json');

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
  readAppState: () =>
    _.attempt(() => JSON.parse(fs.readFileSync(APP_STATE_PATH, 'utf8'))),
  writeAppState: appState =>
    _.attempt(() =>
      fs.writeFileSync(APP_STATE_PATH, JSON.stringify(appState, null, '\t'), 'utf8')
    ),
  getCredentials: () => {
    const appState = self.readAppState();
    return !_.isError(appState) && typeof appState === 'object'
      ? { appState }
      : config.chat.credentials.bot;
  },
  sleep: (s) => {
    const numSecs = _.toNumber(s);
    if (_.isNumber(numSecs)) {
      pausedUntil += (numSecs * 1000);
    }
  },
  /**
   *  Checks if the Facebook message was sent by the bot
   *
   *  @param    {Object}  event  The facebook messenger event object
   *  @returns  {Boolean}  [description]
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
  getWordsv: ({ body = '' }) =>
    _.words(body),
  /**
   *  Gets the command (if there is one) in the message
   *
   *  @param   {Object}  event  The facebook messenger event object.
   *  @return  {String|Undefined}  The commmand, or undefined if there is no command.
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
   *  @return   {String}  The subcommand.
   *  @example
   *
   *  /fanduel info
   *  // => 'info'
   */
  getSubCmd: (cmd, event) => {
    const result = _.attempt(() => {
      let subCmd;
      if (cmd === 'countdown') {
        subCmd = _.camelCase(event.body.split('/countdown')[1]);
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
   *  @return  {*}  The randomly retrieved element.
   */
  getRandomFromArray: (array = []) =>
    array[_.random(array.length - 1)],
  /**
   * Adds possible auto response replies to the matches object
   * @param {Object} event   [description]
   * @return {void}
   */
  addAutoResponseMatch: ({ matches, autoResv, body, type }) => {
    if (body) {
      autoResv.forEach((str) => {
        if (str.length > 1 && (body.indexOf(str) > -1)) {
          matches[type].push(config.facebook.autoResponse[str]);
        }
      });
    }
  },
  /**
   * Gets possible auto responses for a facebook message
   *
   * @param {Object} event [event] The facebook event to check for possible auto responses
   * @param {String} event.body The body (message) of the event
   * @return {Array} An object with words and phrases props, or undefined
   */
  getAutoResponses: (event) => {
    const body = event.body;
    const matches = { words: [], phrases: [], special: [] };

    self.addAutoResponseMatch({
      matches, autoResv: AUTO_RESPONSE_PHRASES, body: _.toLower(body), type: 'phrases',
    });
    self.addAutoResponseMatch({
      matches, autoResv: AUTO_RESPONSE_WORDS, body: _.toLower(body), type: 'words',
    });
    self.addAutoResponseMatch({
      matches, autoResv: AUTO_RESPONSE_SPECIAL, body, type: 'special',
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
   *  @returns  {string}  A stringified leaderboard to send as a chat message.
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
   * {@link http://www.google.com}
   * {@link http://www.google.com|Google}
   * {@link http://www.google.com Google}
   * {@link http://www.google.com Google}
   *  @param    {Object}  chat
   */
  checkPresence: (chat) => {
    chat.getThreadInfo('1184034474942360', (getThreadErr, info) => {
      if (getThreadErr) {
        console.error(getThreadErr);
      } else if (info) {
        const userIds = config.facebook.userId;
        const pIds = info.participantIDs;
        if (pIds.indexOf(userIds.bot) === -1
        || pIds.indexOf(userIds.tony) === -1) {
          console.log('re-adding tonys for 1184034474942360');
          chat.addUserToGroup(userIds.bot, '1184034474942360');
          chat.addUserToGroup(userIds.tony, '1184034474942360');
        }
      }
    });
  },
  getWeather: json =>
    `Weather in ${json.name}\u000AHumidity: ${json.main.humidity}\u000ACurrent Temp: ${json.main.temp} (${json.weather[0].main})\u000AHigh/Low Temp: ${json.main.temp_max}/${json.main.temp_min}`,
  debug: (obj) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEBUG] ${JSON.stringify(obj)}`);
    }
  },
};
