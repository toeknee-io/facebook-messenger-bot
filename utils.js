const _ = require('lodash');
const config = require('./config.json');

const PAUSE_TIMER = config.chat.pauseTimer;
const URL_API_FAN_DUEL = 'https://api.fanduel.com';

let pausedUntil = Date.now();

const self = module.exports = {
  getCmd: (body) => {
    let cmd;
    if (_.startsWith(body, '/')) {
      const idx = body.indexOf(' ');
      cmd = _.lowerCase(body.substring(1, idx));
      console.log(`[${cmd}] cmd received`);
    }
    return cmd;
  },
  getSubCmd: (cmd, event) => {
    const result = _.attempt(() => {
      let subCmd;
      if (cmd === 'fanduel') {
        const params = event.body.split(/\s/).splice(1);
        subCmd = _.lowerCase(params[0]);
      } else if (cmd === 'countdown') {
        subCmd = _.camelCase(event.body.split('/countdown').splice(1).toString());
      }
      console.log(`[${cmd}] subCmd: ${subCmd}`);
      return subCmd;
    });
    if (_.isError(result)) {
      console.error(`[${cmd}] failed to getSubCmd from: ${event.body}`);
    }
    return result;
  },
  canRespond: (cmd, event) => {
    if (_.isString(cmd)) {
      const now = parseInt(event.timestamp, 10);
      if (now > pausedUntil) {
        pausedUntil = Date.now() + PAUSE_TIMER;
        return true;
      }
      console.error(`[${cmd}] skipping, cooldown remaining [${now - pausedUntil}]`);
    }
    return false;
  },
  getFanDuelBaseUrl: (event) => {
    const cmdArray = event.body.split(/\s/);
    if (cmdArray.length === 3) {
      const contestId = cmdArray.splice(1)[1];

      if (contestId && (contestId.indexOf('-') > -1)) {
        config.fanDuel.contest.id = contestId;
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

};
