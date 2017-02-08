const fs = require('fs');
const _ = require('lodash');
const path = require('path');
const mmm = require('mmmagic');
const rp = require('request-promise');
const config = require('../config.json');
const utils = require('./utils.js');
const moment = require('./moment-extended.js');

const magic = new mmm.Magic(mmm.MAGIC_MIME);

const ENV = process.env.NODE_ENV;
const DIR_ART = `${__dirname}/../art`;
const DIR_GIF = `${__dirname}/../gif`;

const badCmdRes = [
  'No', 'In you own ass', 'Eff that', '¯\u005C_(ツ)_/¯',
  { sticker: '1057971357612846' },
  { attachment: fs.createReadStream(`${DIR_ART}/1.jpg`, 'utf8') },
];

module.exports = function cmd(chat, event) {
  const subCmd = utils.getSubCmd(event);
  const toId = ENV !== 'development'
    ? event.threadID
    : config.facebook.userId.tony;

  if (event.cmd === 'art') {
    const artFiles = utils.getArtFiles();
    if (subCmd) {
      if (subCmd === 'add') {
        utils.addArtQueue(event);
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
                    console.error(`failed to delete invalid art file: ${filePath}`);
                  }
                });
              }
              if (attachment.length === artFiles.length) {
                chat.sendMsg({ attachment }, toId);
              }
            }
          });
        });
      } else if (subCmd === 'refresh') {
        let msg = 'Art has been refreshed:\u000A\u000A';

        const files = _.sortBy(fs.readdirSync(DIR_ART, 'utf8'), file => _.toNumber(file.replace('.jpg', '')));
        files.forEach(file => (msg += `${file.replace('.jpg', '')}\u000A`));

        chat.sendMsg(msg, toId);
      } else if (subCmd === 'list') {
        artFiles.forEach(file =>
          chat.sendMsg(
            { body: `/art ${file.replace('.jpg', '')}`, attachment: fs.createReadStream(`${DIR_ART}/${file}`) },
            event.senderID
          ));
      } else {
        const fileName = path.extname(subCmd) === '.jpg' ? subCmd : `${subCmd}.jpg`;
        const msg = artFiles.indexOf(fileName) > -1
          ? { attachment: fs.createReadStream(`${DIR_ART}/${fileName}`) }
          : utils.getRandomFromArray(badCmdRes);

        chat.sendMsg(msg, toId);
      }
    } else {
      const file = utils.getRandomFromArray(artFiles);

      chat.sendMsg({
        body: `/art ${file.replace('.jpg', '')}`,
        attachment: fs.createReadStream(`${DIR_ART}/${file}`),
      }, toId);
    }
  }
  if (event.cmd === 'trump') {
    if (subCmd && (subCmd === 'tony' || subCmd === 'trump')) {
      chat.sendMsg(`${subCmd} is making bots great again`, toId);
    } else {
      const opts = {
        uri: `${config.trump.api.uri}/${subCmd ? 'personalized' : 'random'}`,
        qs: { q: subCmd },
        json: true,
      };
      rp(opts).then((json) => {
        const msg = { body: `"${json.message}"`, attachment: fs.createReadStream(`${DIR_ART}/18.jpg`) };
        chat.sendMsg(msg, toId);
      }).catch(err => console.error(`trump err: ${err}`));
    }
  }
  if (event.cmd === 'kick') {
    const kickId = config.facebook.userId[subCmd];
    if (event.senderName === 'tony' && kickId) {
      console.log(`kick: ${subCmd} (${kickId}) from ${event.threadID}`);
      chat.removeUserFromGroup(kickId, event.threadID);
    } else {
      chat.sendMsg(utils.getRandomFromArray(badCmdRes), toId);
    }
  }
  if (event.cmd === 'jerbonics') {
    if (subCmd === 'add') {
      utils.saveJerrism(event.body.split('/jerbonics add')[1].trim());
    } else {
      chat.sendMsg(utils.getJerryReply(), toId);
    }
  }
  if (event.cmd === 'fanduel') {
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
        chat.sendMsg(msg, toId);
      }).catch(err => console.error(`fanduel info req failed: ${err}`));
    }
    if (utils.hasWords(subCmd, 'leaderboard', 'score', 'scores')) {
      rp(opts).then(json =>
        chat.sendMsg(utils.getFanDuelLeaderboard(json), toId)
      ).catch(err => console.error(`[${event.cmd}] failed: ${err}`));
    }
  }
  if (event.cmd === 'countdown') {
    const endDate = config.cooldown.endDate[subCmd];
    const diff = moment().preciseDiff(moment(endDate));
    chat.sendMsg(`${subCmd} (${moment.formatPref(endDate)})\u000A${diff}`, toId);
  }
  if (event.cmd === 'weather') {
    const opts = {
      uri: 'http://api.openweathermap.org/data/2.5/weather',
      qs: {
        units: 'imperial',
        zip: `${subCmd || '97818'},us`,
        appid: config.weather.API_KEY,
      },
      json: true,
    };
    rp(opts).then(json => chat.sendMsg(utils.getWeather(json), toId));
  }
  if (event.cmd === 'shrug') {
    chat.sendMsg('¯\u005C_(ツ)_/¯', toId);
  }
  if (event.cmd === 'gif') {
    const attachment = fs.createReadStream(`${DIR_GIF}/${subCmd}.gif`);
    attachment.once('error', () => chat.sendMsg(utils.getRandomFromArray(badCmdRes), toId));
    attachment.once('readable', () => chat.sendMsg({ attachment }, toId));
  }
  if (event.cmd === 'yoda') {
    if (subCmd) {
      const opts = _.assign(config.yoda.api, { qs: { sentence: subCmd } });
      rp(opts).then(res => chat.sendMsg(res, toId));
    } else {
      chat.sendMsg(utils.getRandomFromArray(badCmdRes), toId);
    }
  }
  if (event.cmd === 'joke') {
    rp('http://api.yomomma.info').then(res => chat.sendMsg(JSON.parse(res).joke, toId));
  }
  if (event.cmd === '8ball' && event.body.match(/\w\?/)) {
    rp(config['8ball'].api)
    .then(res => chat.sendMsg(res, toId));
  }
};
