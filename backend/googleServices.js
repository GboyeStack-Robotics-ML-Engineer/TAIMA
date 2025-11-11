const { google } = require('googleapis');
const googleAuth = require('./googleAuth');

function toDateString(date) {
  if (!date) return undefined;
  if (typeof date === 'string') {
    return date;
  }
  if (date instanceof Date) {
    return date.toISOString();
  }
  return undefined;
}

function buildCalendarEvent(payload = {}) {
  const {
    summary,
    description,
    location,
    start,
    end,
    attendees,
    reminders,
    timeZone,
    conferenceData
  } = payload;

  const event = {
    summary,
    description,
    location,
    start: start ? normalizeDateTime(start, timeZone) : undefined,
    end: end ? normalizeDateTime(end, timeZone) : undefined,
    attendees: normalizeAttendees(attendees),
    reminders: reminders || undefined,
    conferenceData: conferenceData || undefined
  };

  if (!event.start || !event.end) {
    throw new Error('Calendar event requires valid start and end times.');
  }

  return event;
}

function normalizeDateTime(input, defaultTimeZone) {
  if (!input) {
    return undefined;
  }

  if (typeof input === 'string') {
    if (input.length <= 10) {
      return { date: input };
    }
    return {
      dateTime: input,
      timeZone: defaultTimeZone
    };
  }

  if (typeof input === 'object') {
    if (input.date || input.dateTime) {
      return {
        ...input,
        timeZone: input.timeZone || defaultTimeZone
      };
    }

    if (input.year && input.month && input.day) {
      const dateString = `${input.year.toString().padStart(4, '0')}-${input.month.toString().padStart(2, '0')}-${input.day.toString().padStart(2, '0')}`;
      if (input.hour != null && input.minute != null) {
        const hh = String(input.hour).padStart(2, '0');
        const mm = String(input.minute).padStart(2, '0');
        return {
          dateTime: `${dateString}T${hh}:${mm}:00`,
          timeZone: input.timeZone || defaultTimeZone
        };
      }
      return { date: dateString };
    }
  }

  return undefined;
}

function normalizeAttendees(list) {
  if (!Array.isArray(list)) {
    return undefined;
  }

  const attendees = list
    .map((entry) => {
      if (typeof entry === 'string') {
        return { email: entry.trim() };
      }
      if (entry && entry.email) {
        return {
          email: entry.email,
          displayName: entry.displayName,
          responseStatus: entry.responseStatus
        };
      }
      return null;
    })
    .filter(Boolean);

  return attendees.length ? attendees : undefined;
}

function coerceArray(value) {
  if (!value) return undefined;
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function safeQuoteForQuery(text) {
  if (!text) return undefined;
  return `"${String(text).replace(/"/g, '')}"`;
}

async function getCalendarClient() {
  const auth = await googleAuth.getAuthorizedClient();
  return google.calendar({ version: 'v3', auth });
}

async function getGmailClient() {
  const auth = await googleAuth.getAuthorizedClient();
  return google.gmail({ version: 'v1', auth });
}

async function listUpcomingEvents(options = {}) {
  const calendar = await getCalendarClient();
  const {
    calendarId = 'primary',
    maxResults = 10,
    timeMin = new Date().toISOString(),
    timeMax,
    query
  } = options;

  const response = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
    q: query
  });

  return response.data.items || [];
}

async function createCalendarEvent(payload, options = {}) {
  const calendar = await getCalendarClient();
  const calendarId = options.calendarId || 'primary';
  const event = buildCalendarEvent(payload);

  const response = await calendar.events.insert({
    calendarId,
    requestBody: event,
    conferenceDataVersion: event.conferenceData ? 1 : undefined
  });

  return response.data;
}

async function updateCalendarEvent(eventId, payload, options = {}) {
  if (!eventId) {
    throw new Error('Missing event id for update.');
  }
  const calendar = await getCalendarClient();
  const calendarId = options.calendarId || 'primary';
  const event = buildCalendarEvent(payload);

  const response = await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: event,
    conferenceDataVersion: event.conferenceData ? 1 : undefined
  });

  return response.data;
}

async function deleteCalendarEvent(eventId, options = {}) {
  if (!eventId) {
    throw new Error('Missing event id for deletion.');
  }
  const calendar = await getCalendarClient();
  const calendarId = options.calendarId || 'primary';

  await calendar.events.delete({ calendarId, eventId });
  return { eventId };
}

async function listGmailMessages(options = {}) {
  const gmail = await getGmailClient();
  const {
    labelIds,
    maxResults = 10,
    query
  } = options;

  const listResponse = await gmail.users.messages.list({
    userId: 'me',
    labelIds,
    maxResults,
    q: query
  });

  const messages = listResponse.data.messages || [];

  const detailedMessages = await Promise.all(messages.map(async (message) => {
    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: message.id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'To', 'Date']
    });

    return {
      id: detail.data.id,
      threadId: detail.data.threadId,
      labelIds: detail.data.labelIds,
      snippet: detail.data.snippet,
      headers: parseHeaders(detail.data.payload?.headers)
    };
  }));

  return detailedMessages;
}

function parseHeaders(headers = []) {
  const result = {};
  headers.forEach((header) => {
    if (header && header.name) {
      result[header.name.toLowerCase()] = header.value;
    }
  });
  return {
    subject: result.subject,
    from: result.from,
    to: result.to,
    date: result.date
  };
}

function resolveEmailBody(payload = {}) {
  return (
    payload.body ??
    payload.html ??
    payload.text ??
    payload.content ??
    payload.message ??
    payload.snippet
  );
}

async function sendEmail(payload = {}) {
  const gmail = await getGmailClient();
  const body = resolveEmailBody(payload);
  const raw = buildRawEmail({ ...payload, body });

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw
    }
  });

  return response.data;
}

function buildRawEmail({ to, subject, body, cc, bcc, from }) {
  if (!to || !subject || !body) {
    throw new Error('Email requires "to", "subject", and "body" fields.');
  }

  const headers = [
    `To: ${Array.isArray(to) ? to.join(', ') : to}`,
    `Subject: ${subject}`,
    `Content-Type: text/html; charset=utf-8`
  ];

  if (from) {
    headers.push(`From: ${from}`);
  }

  if (cc) {
    headers.push(`Cc: ${Array.isArray(cc) ? cc.join(', ') : cc}`);
  }

  if (bcc) {
    headers.push(`Bcc: ${Array.isArray(bcc) ? bcc.join(', ') : bcc}`);
  }

  const email = `${headers.join('\r\n')}\r\n\r\n${body}`;
  return Buffer.from(email).toString('base64url');
}

async function replyToEmail(payload = {}) {
  const gmail = await getGmailClient();
  const { subject, to, cc, bcc } = payload;

  const body = resolveEmailBody(payload);
  if (!body) {
    throw new Error('Reply requires body content.');
  }

  const { messageId, threadId } = await resolveReplyContext(gmail, payload);

  const headers = [];
  if (subject) {
    headers.push(`Subject: ${subject}`);
  }
  if (to) {
    headers.push(`To: ${Array.isArray(to) ? to.join(', ') : to}`);
  }
  if (cc) {
    headers.push(`Cc: ${Array.isArray(cc) ? cc.join(', ') : cc}`);
  }
  if (bcc) {
    headers.push(`Bcc: ${Array.isArray(bcc) ? bcc.join(', ') : bcc}`);
  }
  headers.push(`In-Reply-To: ${messageId}`);
  headers.push(`References: ${messageId}`);
  headers.push('Content-Type: text/html; charset=utf-8');

  const email = `${headers.join('\r\n')}\r\n\r\n${body}`;
  const raw = Buffer.from(email).toString('base64url');

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw,
      threadId
    }
  });

  return response.data;
}

async function resolveReplyContext(gmail, payload = {}) {
  let { messageId, threadId } = payload;

  if (messageId && threadId) {
    return { messageId, threadId };
  }

  if (threadId && !messageId) {
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'minimal'
    });

    const latest = thread.data?.messages?.slice(-1)[0];
    if (latest?.id) {
      return { messageId: latest.id, threadId: thread.data.id };
    }
  }

  const labelIds = coerceArray(payload.labelIds);
  const queryParts = [];

  if (payload.query) queryParts.push(payload.query);
  if (payload.subject) queryParts.push(`subject:${safeQuoteForQuery(payload.subject)}`);
  if (payload.from) queryParts.push(`from:${payload.from}`);
  if (payload.to) queryParts.push(`to:${payload.to}`);
  if (payload.after) queryParts.push(`after:${payload.after}`);
  if (payload.before) queryParts.push(`before:${payload.before}`);
  if (payload.threadHint) queryParts.push(payload.threadHint);

  const query = queryParts.filter(Boolean).join(' ').trim() || undefined;

  const listResponse = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 1,
    labelIds
  });

  const candidate = listResponse.data.messages && listResponse.data.messages[0];

  if (candidate) {
    return { messageId: candidate.id, threadId: candidate.threadId };
  }

  const newest = await gmail.users.messages.list({
    userId: 'me',
    maxResults: 1,
    labelIds
  });

  const recent = newest.data.messages && newest.data.messages[0];
  if (!recent) {
    throw new Error('Unable to locate an email thread to reply to. Provide more context.');
  }

  return { messageId: recent.id, threadId: recent.threadId };
}

async function getGmailProfile() {
  const gmail = await getGmailClient();
  const response = await gmail.users.getProfile({ userId: 'me' });
  return response.data;
}

module.exports = {
  listUpcomingEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  listGmailMessages,
  sendEmail,
  replyToEmail,
  getGmailProfile
};
