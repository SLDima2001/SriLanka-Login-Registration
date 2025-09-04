import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const Register = () => {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessRegNo, setBusinessRegNo] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [userType, setUserType] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [showTermsPopup, setShowTermsPopup] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false); // Add loading state
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Check if terms are accepted
    if (!termsAccepted) {
      setError("You must accept the Terms & Conditions to register!");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match!");
      return;
    }

    setIsSubmitting(true); // Start loading
    setError(""); // Clear previous errors

    try {
      const response = await axios.post("http://localhost:5555/api/auth/register", {
        firstName,
        lastName,
        address,
        email,
        phone,
        businessName,
        businessRegNo,
        businessAddress,
        userType,
        password,
        termsAccepted // Include terms acceptance in the data sent to API
      });

      // REPLACE the success alert in your Register.js handleSubmit function with this:
      if (response.data.success) {
        // Updated success message to reflect no automatic subscription creation
        alert(
          "🎉 Registration Successful!\n\n" +
          "✅ Your account has been created and approved\n" +
          "📧 Welcome email sent to " + email + "\n" +
          "🔑 Please check your email for details\n\n" +
          "⚠️ IMPORTANT: Your account is currently non-activated.\n" +
          "After signing in, you must choose a subscription plan (Free or Premium) to access the platform features."
        );
        navigate("/signin");
      } else {
        setError(response.data.message);
      }
    } catch (error) {
      console.error("Registration Error:", error);

      // Handle different error scenarios
      if (error.response?.data?.message) {
        setError(error.response.data.message);
      } else if (error.code === 'NETWORK_ERROR' || error.message.includes('Network Error')) {
        setError("Unable to connect to server. Please check your internet connection and try again.");
      } else {
        setError("Registration failed. Please try again later.");
      }
    } finally {
      setIsSubmitting(false); // Stop loading
    }
  };

  const handleTermsClick = () => {
    setShowTermsPopup(true);
  };

  const closeTermsPopup = () => {
    setShowTermsPopup(false);
  };

  const acceptTerms = () => {
    setTermsAccepted(true);
    setShowTermsPopup(false);
    setError(""); // Clear any previous error
  };

  return (
    <div style={styles.container}>
      <div style={styles.background}></div>

      {/* Terms & Conditions Popup */}
      {showTermsPopup && (
        <div style={styles.popupOverlay}>
          <div style={styles.popupContent}>
            <div style={styles.popupHeader}>
              <h2 style={styles.popupTitle}>Terms & Conditions</h2>
              <button style={styles.closeButton} onClick={closeTermsPopup}>×</button>
            </div>
            <div style={styles.termsContent}>
              <h3>Explore Sri Lanka operated by Sixt5 Pvt Ltd.</h3>
              <p><strong>Effective Date:</strong> 12 August 2025</p>

              <p>Please read these Terms & Conditions ("Terms") carefully. These Terms govern your access to and use of the mobile application known as Explore Sri Lanka, its associated web application, and related services, all of which are owned and operated by Sixt5 Pvt Ltd ("we", "us", "our", or "the Service"). By registering, accessing, or using the Service, you agree to be bound by these Terms. If you do not agree, do not use the Service.</p>

              <h4>1. Scope</h4>
              <p>These Terms apply to everyone who uses the Service, including individual public users, business users, advertisers, guests, and visitors. The Service is operated principally for users in Sri Lanka but is accessible internationally.</p>

              <h4>2. Information We Collect</h4>
              <p><strong>A. Public (individual) users</strong></p>
              <ul>
                <li>Contact details you provide (name, email, phone, profile details).</li>
                <li>Content you post, upload or share (text, images, audio, video).</li>
                <li>Device and usage data (device type, OS, IP address, log files, cookies, analytics)</li>
              </ul>

              <p><strong>B. Business users (registration & verification)</strong></p>
              <ul>
                <li>Business name, trading name, registered address, registration number, contact person and contact details.</li>
                <li>Verification documents (e.g., certificate of incorporation, tax registration, identity documents of authorised representatives) when required for validation</li>
              </ul>

              <h4>3. How We Use Data</h4>
              <p>We use collected data to:</p>
              <ul>
                <li>Provide and improve the Service, authenticate and verify business accounts, process transactions and provide customer support.</li>
                <li>Detect, prevent, and respond to fraud, abuse, security incidents and other prohibited behaviour.</li>
                <li>Comply with legal obligations and public authority requests.</li>
                <li>Communicate with you about updates, offers, and service changes (where lawful)</li>
              </ul>

              <h4>4. Data Protection & Cross‑Border Processing</h4>
              <p>We are committed to protecting personal data. Where we process personal data we will comply with applicable data protection laws and related guidance. Business users and public users located in Sri Lanka are subject to Sri Lanka's data protection framework.</p>

              <h4>5. Business Registration & Verification</h4>
              <p>Business users must submit accurate business details and any requested documentation for verification. We may verify business information against third‑party and public records.</p>

              <h4>6. Community Guidelines & Prohibited Content</h4>
              <p>To keep the platform safe and lawful you must not use the Service to post, upload, host, transmit or otherwise make available any content that is illegal, threatening, abusive, harassing, hateful, discriminatory or promotes violence.</p>

              <h4>7. AI, Automation, Bots, Hacking & Cybersecurity</h4>
              <p>Strictly prohibited: Using automated tools, bots, scripts or other software to register, post, scrape, spam, manipulate rankings, or otherwise access the Service without our prior written permission.</p>

              <h4>8. Advertising, Listings & Publisher Responsibility</h4>
              <p>If you publish advertisements, offers, listings or other promotional content on the Service, you represent and warrant that you own or have the necessary rights and permissions to publish that content.</p>

              <h4>9. Enforcement & Penalties</h4>
              <p>We may, at our sole discretion, temporarily suspend, permanently disable, or remove your account and content for violations of these Terms.</p>

              <h4>10. Governing Law & Jurisdiction</h4>
              <p>These Terms are governed by the laws of Sri Lanka. We and you submit to the exclusive jurisdiction of the courts of Sri Lanka for disputes connected with these Terms.</p>

              <h4>11. Contact Information</h4>
              <p>If you have questions, want to exercise your data subject rights, or wish to report a violation, contact us at: <strong>info@sixt5technology.xyz</strong></p>

              <div style={styles.importantNote}>
                <strong>By clicking "Accept", you agree to be bound by these Terms & Conditions.</strong>
              </div>
            </div>
            <div style={styles.popupButtons}>
              <button style={styles.declineButton} onClick={closeTermsPopup}>Decline</button>
              <button style={styles.acceptButton} onClick={acceptTerms}>Accept Terms</button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} style={styles.form}>
        {error && <div style={styles.error}>{error}</div>}

        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>First Name:</label>
            <input
              type="text"
              style={styles.input}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              disabled={isSubmitting}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Last Name:</label>
            <input
              type="text"
              style={styles.input}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              disabled={isSubmitting}
            />
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Address:</label>
          <input
            type="text"
            style={styles.input}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Email:</label>
          <input
            type="email"
            style={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Phone Number:</label>
          <input
            type="tel"
            style={styles.input}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Business Name:</label>
            <input
              type="text"
              style={styles.input}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
              disabled={isSubmitting}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Business Reg No:</label>
            <input
              type="text"
              style={styles.input}
              value={businessRegNo}
              onChange={(e) => setBusinessRegNo(e.target.value)}
              required
              disabled={isSubmitting}
            />
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Business Address:</label>
          <input
            type="text"
            style={styles.input}
            value={businessAddress}
            onChange={(e) => setBusinessAddress(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>User Type:</label>
          <select
            style={{ ...styles.input, padding: "10px" }}
            value={userType}
            onChange={(e) => setUserType(e.target.value)}
            required
            disabled={isSubmitting}
          >
            <option value="">-- Select User Type --</option>
            <option value="Individual">Individual</option>
            <option value="Company">Company</option>
            <option value="Agency">Agency</option>
          </select>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Password:</label>
          <input
            type="password"
            style={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Confirm Password:</label>
          <input
            type="password"
            style={styles.input}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </div>

        {/* Terms and Conditions Checkbox */}
        <div style={styles.termsSection}>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              style={styles.checkbox}
              disabled={isSubmitting}
            />
            I agree to the{" "}
            <button
              type="button"
              style={styles.termsLink}
              onClick={handleTermsClick}
              disabled={isSubmitting}
            >
              Terms & Conditions
            </button>
          </label>
        </div>

        <button
          type="submit"
          style={{
            ...styles.button,
            opacity: (!termsAccepted || isSubmitting) ? 0.6 : 1,
            cursor: (!termsAccepted || isSubmitting) ? 'not-allowed' : 'pointer'
          }}
          disabled={!termsAccepted || isSubmitting}
        >
          {isSubmitting ? 'Creating Account...' : 'Register'}
        </button>
        <br />
        <a
          href="/signin"
          style={{
            ...styles.link,
            pointerEvents: isSubmitting ? 'none' : 'auto',
            opacity: isSubmitting ? 0.5 : 1
          }}
        >
          If You Already Have an Account
        </a>
      </form>
    </div>
  );
};

const styles = {
  container: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "100vh",
    position: "relative",
    overflow: "hidden",
    fontFamily: "Arial, sans-serif",
  },
  background: {
    position: "absolute",
    width: "100%",
    height: "100%",
    top: 0,
    left: 0,
    background: "#ffff",
    backgroundSize: "cover",
    filter: "blur(10px)",
    zIndex: 0,
  },
  form: {
    position: "relative",
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    padding: "30px",
    borderRadius: "10px",
    boxShadow: "0px 10px 30px rgba(0, 0, 0, 0.3)",
    width: "500px",
    textAlign: "center",
    zIndex: 1,
  },
  formGroup: {
    marginBottom: "15px",
    textAlign: "left",
  },
  label: {
    display: "block",
    fontSize: "14px",
    fontWeight: "bold",
    color: "#333",
    textTransform: "uppercase",
  },
  input: {
    width: "100%",
    padding: "12px",
    border: "2px solid #ddd",
    borderRadius: "6px",
    fontSize: "16px",
    marginTop: "5px",
    transition: "0.4s",
    outline: "none",
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    boxSizing: "border-box",
  },
  button: {
    width: "100%",
    padding: "12px",
    backgroundColor: "#0063B4",
    color: "white",
    border: "none",
    borderRadius: "6px",
    fontSize: "16px",
    cursor: "pointer",
    transition: "transform 0.3s, box-shadow 0.3s",
    marginTop: "10px",
  },
  error: {
    color: "red",
    marginBottom: "10px",
    fontSize: "14px",
    fontWeight: "bold",
  },
  link: {
    color: "#ff4d4d",
    fontSize: "16px",
    display: "block",
    marginTop: "10px",
    textDecoration: "none",
    fontWeight: "bold",
    cursor: "pointer",
  },
  // Terms section styles
  termsSection: {
    marginBottom: "20px",
    textAlign: "left",
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: "14px",
    color: "#333",
    cursor: "pointer",
  },
  checkbox: {
    marginRight: "8px",
    cursor: "pointer",
  },
  termsLink: {
    background: "none",
    border: "none",
    color: "#2373ce",
    textDecoration: "underline",
    cursor: "pointer",
    fontSize: "14px",
    padding: "0",
  },
  // Popup styles
  popupOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  popupContent: {
    backgroundColor: "white",
    borderRadius: "8px",
    width: "90%",
    maxWidth: "600px",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0px 10px 30px rgba(0, 0, 0, 0.3)",
  },
  popupHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "20px",
    borderBottom: "1px solid #eee",
  },
  popupTitle: {
    margin: 0,
    color: "#333",
    fontSize: "24px",
  },
  closeButton: {
    background: "none",
    border: "none",
    fontSize: "30px",
    cursor: "pointer",
    color: "#666",
    lineHeight: "1",
    padding: "0",
    width: "30px",
    height: "30px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  termsContent: {
    padding: "20px",
    overflowY: "auto",
    flex: 1,
    fontSize: "14px",
    lineHeight: "1.6",
    color: "#333",
  },
  importantNote: {
    backgroundColor: "#f0f8ff",
    padding: "15px",
    borderRadius: "5px",
    marginTop: "20px",
    borderLeft: "4px solid #2373ce",
  },
  popupButtons: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    padding: "20px",
    borderTop: "1px solid #eee",
  },
  declineButton: {
    padding: "10px 20px",
    backgroundColor: "#ccc",
    color: "#333",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
    fontSize: "16px",
    transition: "background-color 0.3s",
  },
  acceptButton: {
    padding: "10px 20px",
    backgroundColor: "#0063B4",
    color: "white",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
    fontSize: "16px",
    transition: "background-color 0.3s",
  },
};

export default Register;