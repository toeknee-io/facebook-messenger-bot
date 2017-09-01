/* eslint-disable */

/*  FANDUEL

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

END FANDUEL */

/* YODAY

if (cmd === 'yoda') {
  if (subCmd) {
    const opts = _.assign(config.yoda.api, { qs: { sentence: subCmd } });
    rp(opts).then(res => chat.sendMessage(res, toId));
  } else {
    chat.sendMessage(utils.getRandomFromArray(replyBadCmd), toId);
  }
}

 END YODA */

/* COUNTDOWN

 if (cmd === 'countdown') {
   const endDate = config.cooldown.endDate[subCmd];
   const diff = moment().preciseDiff(moment(endDate));
   chat.sendMessage(`${_.lowerCase(subCmd)} (${moment.formatPref(endDate)})\u000A${diff}`, toId);
 }

 END COUNTDOWN */
