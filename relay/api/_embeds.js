// Modmail message layouts live here, so the look can be changed without touching the logic.
//
// custom_id formats (must stay in sync with interactions.mjs):
//   mm:r:<userId>               staff clicks "Reply" under a ticket / user reply (opens a modal)
//   mm:rs:<userId>:<messageId>  staff modal submit
//   mm:c:<userId>               staff clicks "Close"
//   mm:u:<ticketMessageId>      user clicks "Reply" under a DM (opens a modal)
//   mm:us:<ticketMessageId>     user modal submit

const { clip, displayName, avatarUrl } = require('./_shared');

const COLORS = { ticket: 0xe8b4b8, staff: 0x94cec4, user: 0x5865f2, log: 0x94cec4, closed: 0x6b7280 };
const btn = (label, style, customId) => ({ type: 2, style, label, custom_id: customId });
const staffRow = (userId) => ({ type: 1, components: [btn('Reply', 1, 'mm:r:' + userId), btn('Close', 2, 'mm:c:' + userId)] });
const userRow = (ticketMsgId) => ({ type: 1, components: [btn('Reply', 1, 'mm:u:' + ticketMsgId)] });

// The request as it appears in the mod channel. opts: { name, email } (email null = hidden by the user).
function ticketMessage(me, t, opts) {
  opts = opts || {};
  return {
    embeds: [{
      title: clip('Support request: ' + t.subject, 250),
      description: t.message,
      color: COLORS.ticket,
      thumbnail: { url: avatarUrl(me) },
      fields: [
        { name: 'Category', value: t.category, inline: true },
        { name: 'From', value: clip(opts.name || displayName(me), 80) + ' (@' + clip(me.username, 40) + ')', inline: true },
        { name: 'User ID', value: clip(me.id, 30), inline: true },
        { name: 'Email', value: opts.email ? clip(opts.email, 200) : 'Not shared', inline: false },
      ],
      timestamp: new Date().toISOString(),
    }],
    components: [staffRow(me.id)],
  };
}

// The copy DM'd to the user when they submit.
function receiptDM(t, ticketMsgId) {
  return {
    embeds: [{
      title: 'We received your support request',
      description: '**' + clip(t.subject, 100) + '**\n' + t.message,
      color: COLORS.user,
      fields: [{ name: 'Category', value: t.category, inline: true }],
      footer: { text: 'A staff member will reply here. Press Reply to add more.' },
      timestamp: new Date().toISOString(),
    }],
    components: [userRow(ticketMsgId)],
  };
}

// A staff reply, as DM'd to the user.
function staffReplyDM(staffName, text, ticketMsgId) {
  return {
    embeds: [{
      title: 'Reply from support',
      description: text,
      color: COLORS.staff,
      footer: { text: 'From ' + clip(staffName, 80) + ' • Press Reply to respond' },
      timestamp: new Date().toISOString(),
    }],
    components: [userRow(ticketMsgId)],
  };
}

// Shown in the mod channel after staff reply (posted as the interaction response).
function staffReplyLog(staffName, userId, text) {
  return {
    embeds: [{
      title: 'Reply sent',
      description: 'To <@' + userId + '>\n' + text,
      color: COLORS.log,
      footer: { text: 'Sent by ' + clip(staffName, 80) },
      timestamp: new Date().toISOString(),
    }],
    allowed_mentions: { parse: [] },
  };
}

// A user's reply, posted to the mod channel (as a reply to the original ticket message).
function userReplyChannel(user, text, ticketMsgId) {
  return {
    embeds: [{
      title: 'Reply from user',
      description: text,
      color: COLORS.user,
      thumbnail: { url: avatarUrl(user) },
      fields: [
        { name: 'From', value: clip(displayName(user), 80) + ' (@' + clip(user.username, 40) + ')', inline: true },
        { name: 'User ID', value: clip(user.id, 30), inline: true },
      ],
      timestamp: new Date().toISOString(),
    }],
    components: [staffRow(user.id)],
    message_reference: { message_id: ticketMsgId, fail_if_not_exists: false },
  };
}

// DM sent to the user when staff close their ticket.
function closedDM(staffName) {
  return {
    embeds: [{
      title: 'Your support request was closed',
      description: 'If you still need help, you can submit a new request on the site.',
      color: COLORS.closed,
      footer: { text: 'Closed by ' + clip(staffName, 80) },
      timestamp: new Date().toISOString(),
    }],
  };
}

// The ticket message after it is closed: same embed, greyed out, no buttons.
function closedTicket(originalEmbed, staffName) {
  return {
    embeds: [Object.assign({}, originalEmbed, { color: COLORS.closed, footer: { text: 'Closed by ' + clip(staffName, 80) } })],
    components: [],
  };
}

module.exports = { ticketMessage, receiptDM, staffReplyDM, staffReplyLog, userReplyChannel, closedDM, closedTicket };
