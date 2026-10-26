// Mail transport interface: { send({ to, subject, text }) }.
// The console mailer is for development; plug an SMTP/SES/Postmark transport in here for launch.
export function createConsoleMailer(log) {
  return { async send({ to, subject, text }) { log.info('mail (console transport)', { to, subject, text }); } };
}
