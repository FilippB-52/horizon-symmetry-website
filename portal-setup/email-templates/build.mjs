// The three emails Supabase sends for the client space, in the studio's
// email design (the same band, card, button and footer as the auto-reply
// emails from apply.horizonsymmetry.com, accepted 28 Sep 2026).
//
//   node portal-setup/email-templates/build.mjs
//
// writes confirm-signup.html, reset-password.html and invite.html next to
// this file. Paste each into Supabase > Authentication > Emails >
// Templates, with the subject printed below it. The {{ ... }} parts are
// Supabase's and are filled in when it sends.
//
// Supabase can't attach images, so the mark is linked from the live site
// (assets/logo-mark.png, the white mark on transparent, same artwork as
// the auto-reply's inline logo). Keep that file where it is.

import { writeFileSync } from "node:fs";

const FONT = "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;";
const MARK = "https://horizonsymmetry.com/assets/logo-mark.png";

// the link lands on our own confirm page, which checks it and moves on
// (see js/portal-login.js). Scanners that open links in an email can't use
// it up, because nothing happens until the page runs.
const link = type => `{{ .SiteURL }}/portal/confirm?token_hash={{ .TokenHash }}&type=${type}`;

const EMAILS = [
  {
    file: "confirm-signup.html",
    template: "Confirm signup",
    subject: "Confirm your email for your client space",
    preheader: "One click and your client space is ready.",
    title: "Confirm your email",
    paragraphs: [
      "Confirm your email and your client space is ready. It's where your project with us lives, from the first questions to the final files.",
    ],
    button: "Confirm my email",
    href: link("email"),
    note: "If you didn't create an account with Horizon Symmetry, ignore this email and nothing happens.",
  },
  {
    file: "reset-password.html",
    template: "Reset password",
    subject: "Reset your password",
    preheader: "Pick a new password for your client space.",
    title: "Reset your password",
    paragraphs: [
      "Someone asked to reset the password for your Horizon Symmetry client space. If that was you, pick a new one here.",
    ],
    button: "Pick a new password",
    href: link("recovery"),
    note: "If it wasn't you, ignore this email. Your password stays as it is.",
  },
  {
    file: "invite.html",
    template: "Invite user",
    subject: "Your client space is ready",
    preheader: "Your project with Horizon Symmetry, in one place.",
    title: "Your client space is ready",
    paragraphs: [
      "We've set up your client space. It's where your project with us lives: what's happening now, what we need from you, and every file once it's ready.",
      "Set a password and you're in.",
    ],
    button: "Set my password",
    href: link("invite"),
    note: "This invite is for {{ .Email }}. If you weren't expecting it, ignore this email.",
  },
];

function button(label, href) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td bgcolor="#EBD9FA" style="background:#EBD9FA; border-radius:8px; padding:3px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td bgcolor="#9B3BE0" style="background:#9B3BE0; border-radius:5px; border-bottom:2px solid #7A2CB8;">
                            <a href="${href}"
                               style="display:inline-block; padding:14px 30px; ${FONT} font-size:15px; font-weight:bold; letter-spacing:0.3px; color:#ffffff; text-decoration:none;">
                              ${label}
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>`;
}

function page(e) {
  const body = e.paragraphs.map((p, i) =>
    `<p style="margin:${i === e.paragraphs.length - 1 ? "0" : "0 0 16px 0"};">${p}</p>`).join("\n                ");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <title>${e.subject}</title>
  </head>
  <body style="margin:0; padding:0; background:#ffffff;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${e.preheader}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           bgcolor="#ffffff" style="background:#ffffff; margin:0; padding:0;">

      <tr>
        <td bgcolor="#0B0A10" style="background:#0B0A10; padding:18px 16px;">
          <table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0"
                 style="width:100%; max-width:620px;">
            <tr>
              <td valign="middle" style="line-height:0; font-size:0; width:43px;">
                <img src="${MARK}" width="43" height="36" alt="Horizon Symmetry"
                     style="display:block; border:0; outline:none; width:43px; height:36px; ${FONT} font-size:12px; line-height:36px; color:#ffffff;" />
              </td>
              <td valign="middle" style="padding-left:16px; ${FONT} font-size:12px; font-weight:bold; letter-spacing:2.4px; text-transform:uppercase; color:#ECE8F2; white-space:nowrap;">
                Horizon Symmetry
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td align="center" style="padding:0 16px 0 16px; background:#ffffff;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="width:100%; max-width:620px; background:#ffffff; border-left:1px solid #9B3BE0; border-right:1px solid #9B3BE0; border-bottom:1px solid #9B3BE0; border-radius:0 0 10px 10px;">

            <tr>
              <td style="padding:34px 32px 0 32px; ${FONT} font-size:22px; line-height:1.3; font-weight:bold; color:#14111A;">
                ${e.title}
              </td>
            </tr>

            <tr>
              <td style="padding:14px 32px 0 32px; ${FONT} font-size:15.5px; line-height:1.7; color:#34303C;">
                ${body}
              </td>
            </tr>

            <tr>
              <td style="padding:24px 32px 0 32px;">
                ${button(e.button, e.href)}
              </td>
            </tr>

            <tr>
              <td style="padding:14px 32px 0 32px; ${FONT} font-size:13px; line-height:1.6; color:#6E6879;">
                Button not working? Copy this into your browser:<br />
                <a href="${e.href}" style="color:#7A2CB8; word-break:break-all;">${e.href}</a>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 32px 0 32px;">
                <div style="height:1px; background:#EFEAF5; line-height:1px; font-size:0;">&nbsp;</div>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 32px 32px 32px; ${FONT} font-size:13px; line-height:1.6; color:#6E6879;">
                ${e.note}
              </td>
            </tr>

          </table>
        </td>
      </tr>

      <tr>
        <td align="center" style="padding:18px 16px 34px 16px; background:#ffffff;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="width:100%; max-width:620px;">
            <tr>
              <td style="${FONT} font-size:12px; line-height:1.7; color:#6E6879;">
                Brand, web, software and content for early-stage founders.
              </td>
              <td align="right" style="text-align:right; ${FONT} font-size:12px; line-height:1.7;">
                <a href="https://horizonsymmetry.com" style="color:#9B3BE0; text-decoration:none;">horizonsymmetry.com</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

    </table>
  </body>
</html>
`;
}

for (const e of EMAILS) {
  writeFileSync(new URL(e.file, import.meta.url), page(e));
  console.log(`${e.template}\n  subject: ${e.subject}\n  body:    portal-setup/email-templates/${e.file}\n`);
}
