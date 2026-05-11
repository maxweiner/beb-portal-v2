// SMS Terms / Opt-In Disclosure page. The URL that gets submitted to
// Twilio's toll-free verification team — they hit this page first
// and reject (error 30509: Opt-In URL Not Accessible) if it doesn't
// clearly document who sends messages, what messages, how the user
// opts in, and the STOP/HELP behaviour. Keep this page publicly
// reachable (no auth gate, no rewrites). If a Twilio resubmission
// references this URL, do not 301/410 it without coordinating.

export const metadata = {
  title: 'SMS Terms & Opt-In — Beneficial Estate Buyers',
  description:
    'How customers opt in to SMS messages from Beneficial Estate Buyers, what messages are sent, and how to opt out.',
}

const wrap: React.CSSProperties = {
  minHeight: '100vh',
  background: '#F5F0E8',
  padding: '40px 20px',
  fontFamily: 'Lato, sans-serif',
  color: '#1F2937',
}
const card: React.CSSProperties = {
  maxWidth: 760, margin: '0 auto',
  background: '#fff', borderRadius: 16,
  padding: '36px 40px',
  boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
}
const h1: React.CSSProperties = { fontSize: 28, fontWeight: 900, color: '#0B1410', marginBottom: 6 }
const meta: React.CSSProperties = { fontSize: 13, color: '#6B7280', marginBottom: 24 }
const h2: React.CSSProperties = { fontSize: 18, fontWeight: 800, color: '#0B1410', marginTop: 24, marginBottom: 8 }
const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, marginBottom: 12 }
const ul: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, marginBottom: 12, paddingLeft: 22 }
const sample: React.CSSProperties = {
  fontSize: 14, lineHeight: 1.55,
  background: '#F5F0E8', borderRadius: 8,
  padding: '10px 14px', marginBottom: 10,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#1F2937',
}

export default function SmsTermsPage() {
  return (
    <div style={wrap}>
      <div style={card}>
        <h1 style={h1}>SMS Terms & Opt-In</h1>
        <div style={meta}>Last updated: May 10, 2026</div>

        <p style={p}>
          This page describes the Beneficial Estate Buyers, LLC
          (&ldquo;BEB,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) SMS
          messaging program: who sends the messages, what messages are
          sent, how you opt in, and how you opt out.
        </p>

        <h2 style={h2}>1. Program description</h2>
        <p style={p}>
          We use SMS to communicate with customers about appointments
          they have booked with Beneficial Estate Buyers — including
          appointment confirmations, reminders, reschedule and
          cancellation notifications, and brief follow-ups after a
          visit. SMS is operational; we do not use SMS for marketing.
        </p>

        <h2 style={h2}>2. How you opt in</h2>
        <p style={p}>
          You opt in to receive SMS messages from Beneficial Estate
          Buyers by submitting your mobile phone number through one of
          our public booking forms. The phone field on each booking
          form is accompanied by a disclosure that providing your
          number constitutes consent to receive SMS messages related
          to your appointment.
        </p>
        <p style={p}>
          Examples of pages where customers opt in:
        </p>
        <ul style={ul}>
          <li>
            Per-store booking pages at <code>/book/&lt;store-slug&gt;</code>
            {' '}— customers reach these through QR codes posted at the
            store or through links the store sends.
          </li>
          <li>
            Waitlist forms at <code>/waitlist/&lt;event-id&gt;</code>{' '}
            for events that are currently full.
          </li>
          <li>
            Trade-show booking pages at <code>/trade-show-book/&lt;token&gt;</code>.
          </li>
          <li>
            Trunk-show booking pages at <code>/trunk-show-book/&lt;token&gt;</code>.
          </li>
        </ul>
        <p style={p}>
          We do not buy, rent, or import phone-number lists, and we do
          not start SMS conversations with anyone who has not given us
          their number through one of the forms above.
        </p>

        <h2 style={h2}>3. Sample messages</h2>
        <p style={p}>The kinds of messages a customer who opts in will receive:</p>

        <div style={sample}>
          Beneficial Estate Buyers: your appointment at Main St Jewelry on
          Tue May 14 at 2:30 PM is confirmed. Reply STOP to opt out.
        </div>
        <div style={sample}>
          Beneficial Estate Buyers: reminder — your appointment is tomorrow
          at 2:30 PM at Main St Jewelry. Reply C to cancel or HELP for help.
        </div>
        <div style={sample}>
          Beneficial Estate Buyers: your appointment has been rescheduled
          to Thu May 16 at 10:00 AM. Reply STOP to opt out.
        </div>

        <h2 style={h2}>4. Message frequency</h2>
        <p style={p}>
          Message frequency varies and depends on the bookings you
          have made. A typical customer receives 1–4 messages per
          booking (confirmation, reminder, and any reschedule or
          cancellation notice).
        </p>

        <h2 style={h2}>5. Cost</h2>
        <p style={p}>
          Message and data rates may apply. SMS messages are charged
          by your mobile carrier at whatever rate your plan specifies.
          Beneficial Estate Buyers does not charge you for SMS.
        </p>

        <h2 style={h2}>6. How to opt out</h2>
        <p style={p}>
          You can opt out of SMS at any time by replying{' '}
          <strong>STOP</strong> to any message we send you. You will
          receive a final confirmation message and no further SMS
          will be sent.
        </p>
        <p style={p}>
          To resume receiving messages after opting out, reply{' '}
          <strong>START</strong> or <strong>UNSTOP</strong>.
        </p>

        <h2 style={h2}>7. How to get help</h2>
        <p style={p}>
          Reply <strong>HELP</strong> to any message and you will
          receive a reply with our contact information. You can also
          reach us at{' '}
          <a href="mailto:hello@beneficialestate.com" style={{ color: '#1D6B44', fontWeight: 700 }}>
            hello@beneficialestate.com
          </a>.
        </p>

        <h2 style={h2}>8. Carriers and disclaimer</h2>
        <p style={p}>
          Supported carriers include all major US carriers (AT&amp;T,
          T-Mobile, Verizon, US Cellular, Sprint, Boost, Cricket,
          MetroPCS, and others). Carriers are not liable for delayed
          or undelivered messages.
        </p>

        <h2 style={h2}>9. Privacy</h2>
        <p style={p}>
          We do not sell or share your mobile phone number or the
          contents of your SMS messages with third parties for their
          marketing purposes. The only third parties who handle your
          number are the service providers we use to send the
          messages (Twilio) and to store your booking record
          (Supabase). For more, see our{' '}
          <a href="/privacy" style={{ color: '#1D6B44', fontWeight: 700 }}>
            Privacy Policy
          </a>.
        </p>

        <h2 style={h2}>10. Contact</h2>
        <p style={p}>
          Questions about this SMS program can be sent to{' '}
          <a href="mailto:hello@beneficialestate.com" style={{ color: '#1D6B44', fontWeight: 700 }}>
            hello@beneficialestate.com
          </a>.
        </p>

        <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid #E5E7EB', fontSize: 13, color: '#6B7280' }}>
          See also: <a href="/privacy" style={{ color: '#1D6B44', fontWeight: 700 }}>Privacy Policy</a> · <a href="/terms" style={{ color: '#1D6B44', fontWeight: 700 }}>Terms of Service</a>
        </div>
      </div>
    </div>
  )
}
