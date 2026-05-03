// Terms of Service page. Linked from the Login page footer and used
// as the Terms of Service URL on Google's OAuth consent screen.

export const metadata = { title: 'Terms of Service — BEB Portal' }

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

export default function TermsPage() {
  return (
    <div style={wrap}>
      <div style={card}>
        <h1 style={h1}>Terms of Service</h1>
        <div style={meta}>Last updated: May 2, 2026</div>

        <p style={p}>
          These Terms of Service (&quot;Terms&quot;) govern your access to and use of
          the BEB Portal (the &quot;Service&quot;) provided by Beneficial Estate
          Buyers, LLP (&quot;BEB,&quot; &quot;we,&quot; &quot;us&quot;). By using the Service, you agree
          to these Terms.
        </p>

        <h2 style={h2}>1. Eligibility and accounts</h2>
        <p style={p}>
          The Service is provided to authorized BEB employees, contractors,
          partners, and invited third parties. You are responsible for
          maintaining the confidentiality of your account credentials and for
          all activity that occurs under your account.
        </p>

        <h2 style={h2}>2. Acceptable use</h2>
        <p style={p}>You agree not to:</p>
        <ul style={ul}>
          <li>Use the Service for any unlawful purpose or in violation of any applicable law.</li>
          <li>Attempt to gain unauthorized access to any portion of the Service or to any other user&apos;s account.</li>
          <li>Probe, scan, or test the vulnerability of the Service or interfere with its operation.</li>
          <li>Use the Service to transmit malware, spam, or unsolicited communications.</li>
          <li>Reverse-engineer, decompile, or disassemble any portion of the Service.</li>
        </ul>

        <h2 style={h2}>3. Your content</h2>
        <p style={p}>
          You retain ownership of any content you submit through the Service.
          You grant BEB a limited license to host, store, process, and display
          that content solely as needed to operate the Service for you and
          your organization.
        </p>

        <h2 style={h2}>4. Confidentiality</h2>
        <p style={p}>
          Information you access through the Service — including but not
          limited to event records, customer information, financial data, and
          marketing materials — is confidential and proprietary to BEB. You
          may not disclose it outside the Service except as authorized in
          writing.
        </p>

        <h2 style={h2}>5. Third-party services</h2>
        <p style={p}>
          The Service uses third-party providers (including Supabase, Vercel,
          Resend, Google, and others). Your use of features that integrate
          with these providers is also subject to their respective terms and
          privacy policies.
        </p>

        <h2 style={h2}>6. Termination</h2>
        <p style={p}>
          We may suspend or terminate your access to the Service at any time,
          with or without cause and with or without notice. Upon termination,
          your right to use the Service ceases immediately. Sections that by
          their nature should survive termination will survive.
        </p>

        <h2 style={h2}>7. Disclaimer of warranties</h2>
        <p style={p}>
          THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT
          WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF
          MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
          NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE
          UNINTERRUPTED, ERROR-FREE, OR SECURE.
        </p>

        <h2 style={h2}>8. Limitation of liability</h2>
        <p style={p}>
          TO THE FULLEST EXTENT PERMITTED BY LAW, BEB WILL NOT BE LIABLE FOR
          ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
          DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED
          DIRECTLY OR INDIRECTLY, ARISING OUT OF OR IN CONNECTION WITH YOUR
          USE OF THE SERVICE.
        </p>

        <h2 style={h2}>9. Changes to these Terms</h2>
        <p style={p}>
          We may update these Terms from time to time. Material changes will
          be reflected by updating the &quot;Last updated&quot; date above. Your
          continued use of the Service after a change constitutes acceptance
          of the revised Terms.
        </p>

        <h2 style={h2}>10. Governing law</h2>
        <p style={p}>
          These Terms are governed by the laws of the State of New York,
          without regard to its conflict-of-laws principles.
        </p>

        <h2 style={h2}>11. Contact us</h2>
        <p style={p}>
          Questions about these Terms? Email{' '}
          <a href="mailto:max@bebllp.com" style={{ color: '#1D6B44', fontWeight: 700 }}>
            max@bebllp.com
          </a>
          .
        </p>
      </div>
    </div>
  )
}
