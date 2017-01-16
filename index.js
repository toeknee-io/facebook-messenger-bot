/* TO-DO
  parse cmds less dumbly
  send msgs less dumbly
  automate getting fanduel auth header
  automate getting/setting fanduel contestId
*/

const fs = require('fs');
const _ = require('lodash');
const utils = require('./utils.js');
const lyr = require('lyrics-fetcher');
const config = require('./config.json');
const moment = require('./moment-wrapped.js');
const rp = require('request-promise');

const appState = _.attempt(() => JSON.parse(fs.readFileSync('app-state.json', 'utf8')));
const credentials = !_.isError(appState) && typeof appState === 'object'
  ? { appState }
  : config.chat.credentials;

require('facebook-chat-api')(credentials, (loginErr, chat) => {
  if (loginErr) {
    throw loginErr;
  }

  fs.writeFileSync('app-state.json', JSON.stringify(chat.getAppState()), 'utf8');

  chat.setOptions(config.chat.options);

  chat.listen((listenErr, event) => {
    if (listenErr) {
      throw listenErr;
    }

    console.log('event: %j', event);

    const body = event.body;
    const cmd = utils.getCmd(body);

    if (utils.canRespond(cmd, event)) {
      const toId = event.threadID;
      const subCmd = utils.getSubCmd(cmd, event);

      if (cmd === 'lyrics') {
        try {
          const artist = event.body.substring(
            event.body.indexOf('artist='),
            event.body.indexOf(' song='))
          .replace('artist=', '')
          .trim();

          const song = event.body.substring(
            event.body.indexOf('song='))
          .replace('song=', '')
          .trim();

          lyr.fetch(artist, song, (lyrErr, lyrics) => {
            if (lyrErr) throw lyrErr;
            chat.sendMessage(lyrics, toId);
          });
        } catch (lyrErr) {
          chat.sendMessage(`Oops: ${lyrErr.message}`, toId);
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
            /* eslint-disable comma-dangle */
            const msg = `ID: ${contest.id}\u000AName: ${contest.name}\u000AEntered: ${entered}/${contest.size.min}`;
            chat.sendMessage(msg, toId);
            /* eslint-enable comma-dangle */
          }).catch(err => console.error(`[${cmd}] failed: ${err}`));
        }

        if (subCmd === 'leaderboard' || subCmd === 'score') {
          rp(opts).then((json) => {
            const leaderboard = utils.getFanDuelLeaderboard(json);
            chat.sendMessage(leaderboard, toId);
          });
        }
      }

      if (cmd === 'countdown') {
        const endDate = config.cooldown.endDate[subCmd];
        const diff = moment().preciseDiff(moment(endDate));
        chat.sendMessage(`${_.lowerCase(subCmd)} (${moment.formatPref(endDate)})\u000A${diff}`, toId);
      }
    }
  });
});
