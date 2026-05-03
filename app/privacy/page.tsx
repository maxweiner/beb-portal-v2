// Privacy policy page. Linked from the Login page footer and used as
// the Privacy Policy URL on Google's OAuth consent screen.

export const metadata = { title: 'Privacy Policy — BEB Portal' }

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

export default function PrivacyPage() {
  return (
    <div style={wrap}>
      <div style={card}>
        <h1 style={h1}>Privacy Policy</h1>
        <div style={meta}>Last updated: May 2, 2026</div>

        <p style={p}>
          This Privacy Policy describes how Beneficial Estate Buyers, LLP
          (&quot;BEB,&quot; &quot;we,&quot; &quot;us&quot;) collects, uses, and protects information
          when you use the BEB Portal (the &quot;Service&quot;).
        </p>

        <h2 style={h2}>1. Information we collect</h2>
        <p style={p}>When you sign in or use the Service, we may collect:</p>
        <ul style={ul}>
          <li>Account information you provide (name, email address, phone number, role).</li>
          <li>Authentication data from third-party providers (e.g., your Google account email and basic profile fields) when you choose to sign in with Google.</li>
          <li>Operational data you submit through the Service (events, expenses, customer records, scheduling, marketing materials, and similar work-product content).</li>
          <li>Technical data such as IP address, device type, browser, and timestamps for security and debugging.</li>
        </ul>

        <h2 style={h2}>2. How we use information</h2>
        <ul style={ul}>
          <li>To authenticate you and provide access to the Service.</li>
          <li>To operate features you request (e.g., scheduling, expense reporting, customer management).</li>
          <li>To send transactional emails (e.g., magic-link sign-ins, expense reminders, booking confirmations).</li>
          <li>To maintain security, detect abuse, and comply with legal obligations.</li>
        </ul>

        <h2 style={h2}>3. Google user data</h2>
        <p style={p}>
          If you sign in with Google, we receive your email address and basic
          profile information from Google solely to authenticate you and
          associate your session with your account in the Service. We do not
          sell Google user data, and we do not use it for advertising. Where
          the Service uses Google APIs (for example, Google Calendar
          integration), it does so only with your explicit authorization and
          only to provide the requested feature.
        </p>

        <h2 style={h2}>4. How we share information</h2>
        <p style={p}>We do not sell personal information. We share information only:</p>
        <ul style={ul}>
          <li>With service providers who host or operate parts of the Service on our behalf (e.g., Supabase for database/auth, Resend for transactional email, Vercel for hosting).</li>
          <li>When required by law, subpoena, or to protect our rights and the safety of users.</li>
          <li>In connection with a business transaction such as a merger or acquisition, subject to confidentiality protections.</li>
        </ul>

        <h2 style={h2}>5. Data retention</h2>
        <p style={p}>
          We retain account and operational data for as long as your account
          is active or as needed to provide the Service and meet legal,
          accounting, or audit obligations. You may request deletion of your
          data by contacting us at the address below.
        </p>

        <h2 style={h2}>6. Security</h2>
        <p style={p}>
          We use industry-standard safeguards including encryption in transit,
          row-level security in our database, and access controls. No system
          is perfectly secure, and we cannot guarantee absolute security.
        </p>

        <h2 style={h2}>7. Your choices</h2>
        <p style={p}>
          You may request access to, correction of, or deletion of your
          personal information by emailing us. You may also revoke Google
          access from your Google account&apos;s permissions page at any time.
        </p>

        <h2 style={h2}>8. Changes to this policy</h2>
        <p style={p}>
          We may update this Privacy Policy from time to time. Material
          changes will be reflected by updating the &quot;Last updated&quot; date
          above.
        </p>

        <h2 style={h2}>9. Contact us</h2>
        <p style={p}>
          Questions about this policy? Email{' '}
          <a href="mailto:max@bebllp.com" style={{ color: '#1D6B44', fontWeight: 700 }}>
            max@bebllp.com
          </a>
          .
        </p>
      </div>
    </div>
  )
}
