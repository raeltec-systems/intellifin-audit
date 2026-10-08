const { writeFileSync } = require('node:fs');
module.exports = class CursorReporter {
  onTestEnd(_test, result) {
    for (const attachment of result.attachments) {
      if (attachment.name === 'conversation-history-cursors.json' && attachment.contentType === 'application/json' && attachment.body) {
        writeFileSync('/tmp/zobba-story-21-2/repair-1/conversation-history-cursors-full.json', attachment.body);
      }
    }
  }
};
