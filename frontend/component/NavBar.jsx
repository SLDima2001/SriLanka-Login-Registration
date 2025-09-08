import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const NavBar = ({ adminUser, logoutAdmin }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Handle screen size changes
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
      if (window.innerWidth > 768) {
        setMobileMenuOpen(false);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle scroll effect
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isActiveRoute = (path) => {
    return location.pathname === path;
  };

  const styles = {
    navbar: {
      background: scrolled 
        ? "rgba(255, 255, 255, 0.95)" 
        : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      backdropFilter: scrolled ? "blur(10px)" : "none",
      position: "sticky",
      top: 0,
      zIndex: 1000,
      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      boxShadow: scrolled 
        ? "0 8px 32px rgba(0, 0, 0, 0.12)" 
        : "0 4px 20px rgba(0, 0, 0, 0.1)",
    },

    header: {
      padding: "0px 0px",
    },

    headerTop: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "16px 24px",
      borderBottom: scrolled ? "1px solid rgba(226, 232, 240, 0.3)" : "none",
    },

    rightSection: {
      display: "flex",
      alignItems: "center",
      gap: "16px",
    },

    navButtonsContainer: {
      display: "flex",
      gap: "12px",
      padding: "20px 24px 24px",
      background: scrolled 
        ? "transparent" 
        : "linear-gradient(to right, rgba(255,255,255,0.1), rgba(255,255,255,0.05))",
    },

    mobileHeader: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "16px 20px",
      background: "inherit",
    },

    mobileMenuButton: {
      padding: "12px",
      background: "rgba(255, 255, 255, 0.2)",
      border: "1px solid rgba(255, 255, 255, 0.3)",
      borderRadius: "12px",
      cursor: "pointer",
      fontSize: "18px",
      color: scrolled ? "#374151" : "#ffffff",
      transition: "all 0.3s ease",
      backdropFilter: "blur(10px)",
    },

    mobileMenuOverlay: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0, 0, 0, 0.6)",
      backdropFilter: "blur(4px)",
      zIndex: 999,
      display: mobileMenuOpen ? "block" : "none",
      animation: mobileMenuOpen ? "fadeIn 0.3s ease" : "fadeOut 0.3s ease",
    },

    mobileMenu: {
      position: "fixed",
      top: 0,
      right: mobileMenuOpen ? 0 : "-320px",
      width: "300px",
      minHeight: "100vh",
      background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
      boxShadow: "-8px 0 40px rgba(0, 0, 0, 0.15)",
      zIndex: 1000,
      transition: "right 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
      display: "flex",
      flexDirection: "column",
    },

    mobileMenuHeader: {
      padding: "24px",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      color: "white",
    },

    mobileMenuContent: {
      flex: 1,
      padding: "24px",
      display: "flex",
      flexDirection: "column",
      gap: "16px",
    },

    mobileCloseButton: {
      position: "absolute",
      top: "20px",
      right: "20px",
      padding: "8px",
      background: "rgba(255, 255, 255, 0.2)",
      border: "none",
      borderRadius: "50%",
      fontSize: "18px",
      color: "#ffffff",
      cursor: "pointer",
      width: "36px",
      height: "36px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "all 0.2s ease",
    },

    userInfoBox: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      padding: "16px",
      background: scrolled 
        ? "rgba(248, 250, 252, 0.8)" 
        : "rgba(255, 255, 255, 0.2)",
      borderRadius: "16px",
      border: scrolled 
        ? "1px solid rgba(226, 232, 240, 0.5)" 
        : "1px solid rgba(255, 255, 255, 0.3)",
      backdropFilter: "blur(10px)",
      transition: "all 0.3s ease",
    },

    userIcon: {
      fontSize: "20px",
      width: "40px",
      height: "40px",
      borderRadius: "50%",
      background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "white",
    },

    userName: {
      fontSize: "14px",
      fontWeight: "600",
      color: scrolled ? "#1e293b" : "#ffffff",
      margin: 0,
      transition: "color 0.3s ease",
    },

    desktopNavButton: {
      padding: "14px 28px",
      background: scrolled 
        ? "rgba(255, 255, 255, 0.9)" 
        : "rgba(255, 255, 255, 0.2)",
      border: scrolled 
        ? "1px solid rgba(226, 232, 240, 0.5)" 
        : "1px solid rgba(255, 255, 255, 0.3)",
      borderRadius: "12px",
      fontSize: "14px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      color: scrolled ? "#374151" : "#ffffff",
      position: "relative",
      overflow: "hidden",
      backdropFilter: "blur(10px)",
    },

    desktopNavButtonActive: {
      padding: "14px 28px",
      background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
      border: "1px solid transparent",
      borderRadius: "12px",
      fontSize: "14px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      color: "#ffffff",
      boxShadow: "0 8px 25px rgba(59, 130, 246, 0.3)",
      position: "relative",
      overflow: "hidden",
    },

    mobileMenuItem: {
      display: "flex",
      alignItems: "center",
      gap: "16px",
      padding: "16px 20px",
      borderRadius: "12px",
      cursor: "pointer",
      transition: "all 0.3s ease",
      color: "#374151",
      fontSize: "15px",
      fontWeight: "500",
      border: "1px solid #e2e8f0",
      background: "#ffffff",
      position: "relative",
      overflow: "hidden",
    },

    mobileMenuItemActive: {
      display: "flex",
      alignItems: "center",
      gap: "16px",
      padding: "16px 20px",
      borderRadius: "12px",
      cursor: "pointer",
      transition: "all 0.3s ease",
      color: "#ffffff",
      fontSize: "15px",
      fontWeight: "600",
      border: "1px solid transparent",
      background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
      boxShadow: "0 4px 15px rgba(59, 130, 246, 0.3)",
    },

    menuItemIcon: {
      fontSize: "18px",
      width: "24px",
      textAlign: "center",
    },

    logoutButton: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      padding: "16px 20px",
      background: "linear-gradient(135deg, #ef4444, #dc2626)",
      border: "none",
      borderRadius: "12px",
      color: "#ffffff",
      fontSize: "15px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "all 0.3s ease",
      marginTop: "auto",
      boxShadow: "0 4px 15px rgba(239, 68, 68, 0.3)",
    },

    desktopLogoutButton: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "12px 20px",
      background: scrolled 
        ? "linear-gradient(135deg, #ef4444, #dc2626)" 
        : "rgba(239, 68, 68, 0.2)",
      border: scrolled 
        ? "none" 
        : "1px solid rgba(255, 255, 255, 0.3)",
      borderRadius: "12px",
      color: "#ffffff",
      fontSize: "14px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "all 0.3s ease",
      backdropFilter: "blur(10px)",
      boxShadow: scrolled ? "0 4px 15px rgba(239, 68, 68, 0.3)" : "none",
    },

    logoutIcon: {
      fontSize: "16px",
    },

    logoImgStyle: {
      height: "auto",
      width: "90px",
      filter: scrolled ? "none" : "brightness(0) invert(1)",
      transition: "filter 0.3s ease",
      borderRadius: "8px",
    },
  };

  // CSS for animations (inject into head)
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
      @keyframes slideInFromRight {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  const handleOffersNavigation = () => {
    try {
      navigate("/admin/offers");
      setMobileMenuOpen(false);
    } catch (error) {
      console.error("Navigation error:", error);
      alert("Error navigating to offers page");
    }
  };

  const handleStatsNavigation = () => {
    try {
      navigate("/detailsstats");
      setMobileMenuOpen(false);
    } catch (error) {
      console.error("Navigation error:", error);
      alert("Error navigating to statistics page");
    }
  };

  const handleDashboardNavigation = () => {
    try {
      navigate("/usershowpage");
      setMobileMenuOpen(false);
    } catch (error) {
      console.error("Navigation error:", error);
      alert("Error navigating to Dashboard page");
    }
  };

  const handleLogout = async () => {
    try {
      const confirmLogout = window.confirm("Are you sure you want to logout?");
      if (confirmLogout) {
        if (typeof logoutAdmin === 'function') {
          await logoutAdmin();
          navigate("/adminsignin");
          setMobileMenuOpen(false);
        } else {
          navigate("/adminsignin");
        }
      }
    } catch (error) {
      console.error("Error during logout:", error);
      navigate("/adminsignin");
    }
  };

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const addHoverEffect = (e, isActive, isLogout = false) => {
    if (!isActive) {
      if (isLogout) {
        e.target.style.transform = "translateY(-2px) scale(1.02)";
        e.target.style.boxShadow = "0 8px 25px rgba(239, 68, 68, 0.4)";
      } else {
        e.target.style.transform = "translateY(-2px) scale(1.02)";
        e.target.style.boxShadow = "0 8px 25px rgba(59, 130, 246, 0.2)";
        e.target.style.background = scrolled 
          ? "rgba(59, 130, 246, 0.1)" 
          : "rgba(255, 255, 255, 0.3)";
      }
    }
  };

  const removeHoverEffect = (e, isActive, isLogout = false) => {
    if (!isActive) {
      e.target.style.transform = "translateY(0) scale(1)";
      e.target.style.boxShadow = "none";
      if (!isLogout) {
        e.target.style.background = "#ffffff";
      }
    }
  };

  return (
    <div style={styles.navbar}>
      {isMobile ? (
        <>
          <div style={styles.mobileHeader}>
            <img src="./Images/Logo.png" alt="LOGO" style={styles.logoImgStyle} />
            <button
              style={styles.mobileMenuButton}
              onClick={toggleMobileMenu}
              onMouseEnter={(e) => {
                e.target.style.background = "rgba(255, 255, 255, 0.3)";
                e.target.style.transform = "scale(1.1)";
              }}
              onMouseLeave={(e) => {
                e.target.style.background = "rgba(255, 255, 255, 0.2)";
                e.target.style.transform = "scale(1)";
              }}
            >
              ☰
            </button>
          </div>

          <div style={styles.mobileMenuOverlay} onClick={() => setMobileMenuOpen(false)} />

          <div style={styles.mobileMenu}>
            <button
              style={styles.mobileCloseButton}
              onClick={() => setMobileMenuOpen(false)}
              onMouseEnter={(e) => {
                e.target.style.background = "rgba(255, 255, 255, 0.3)";
                e.target.style.transform = "rotate(90deg)";
              }}
              onMouseLeave={(e) => {
                e.target.style.background = "rgba(255, 255, 255, 0.2)";
                e.target.style.transform = "rotate(0deg)";
              }}
            >
              ✕
            </button>

            <div style={styles.mobileMenuHeader}>
              <div style={{...styles.userInfoBox, background: "rgba(255, 255, 255, 0.2)", border: "1px solid rgba(255, 255, 255, 0.3)"}}>
                <div style={styles.userIcon}>👤</div>
                <div>
                  <div style={{...styles.userName, color: "#ffffff"}}>
                    {adminUser?.username || adminUser?.name || "Admin"}
                  </div>
                </div>
              </div>
            </div>

            <div style={styles.mobileMenuContent}>
              <button
                style={isActiveRoute("/usershowpage") ? styles.mobileMenuItemActive : styles.mobileMenuItem}
                onClick={handleDashboardNavigation}
                onMouseEnter={(e) => addHoverEffect(e, isActiveRoute("/usershowpage"))}
                onMouseLeave={(e) => removeHoverEffect(e, isActiveRoute("/usershowpage"))}
              >
                <span style={styles.menuItemIcon}>📊</span>
                <span>Dashboard</span>
              </button>

              <button
                style={isActiveRoute("/detailsstats") ? styles.mobileMenuItemActive : styles.mobileMenuItem}
                onClick={handleStatsNavigation}
                onMouseEnter={(e) => addHoverEffect(e, isActiveRoute("/detailsstats"))}
                onMouseLeave={(e) => removeHoverEffect(e, isActiveRoute("/detailsstats"))}
              >
                <span style={styles.menuItemIcon}>📈</span>
                <span>Detailed Statistics</span>
              </button>

              <button
                style={isActiveRoute("/admin/offers") ? styles.mobileMenuItemActive : styles.mobileMenuItem}
                onClick={handleOffersNavigation}
                onMouseEnter={(e) => addHoverEffect(e, isActiveRoute("/admin/offers"))}
                onMouseLeave={(e) => removeHoverEffect(e, isActiveRoute("/admin/offers"))}
              >
                <span style={styles.menuItemIcon}>🎁</span>
                <span>Offers Details</span>
              </button>

              <button
                style={styles.logoutButton}
                onClick={handleLogout}
                onMouseEnter={(e) => addHoverEffect(e, false, true)}
                onMouseLeave={(e) => removeHoverEffect(e, false, true)}
              >
                <span style={styles.logoutIcon}>🚪</span>
                <span>Logout</span>
              </button>
            </div>
          </div>
        </>
      ) : (
        <div style={styles.header}>
          <div style={styles.headerTop}>
            <img src="./Images/Logo.png" alt="LOGO" style={styles.logoImgStyle} />
            <div style={styles.rightSection}>
              <div style={styles.userInfoBox}>
                <div style={styles.userIcon}>👤</div>
                <div>
                  <div style={styles.userName}>
                    {adminUser?.username || adminUser?.name || "Admin"}
                  </div>
                </div>
              </div>

              <button
                style={styles.desktopLogoutButton}
                onClick={handleLogout}
                onMouseEnter={(e) => addHoverEffect(e, false, true)}
                onMouseLeave={(e) => removeHoverEffect(e, false, true)}
              >
                <span style={styles.logoutIcon}>🚪</span>
                <span>Logout</span>
              </button>
            </div>
          </div>

          <div style={styles.navButtonsContainer}>
            <button
              style={isActiveRoute("/usershowpage") ? styles.desktopNavButtonActive : styles.desktopNavButton}
              onClick={handleDashboardNavigation}
              onMouseEnter={(e) => addHoverEffect(e, isActiveRoute("/usershowpage"))}
              onMouseLeave={(e) => removeHoverEffect(e, isActiveRoute("/usershowpage"))}
            >
              📊 User Dashboard
            </button>

            <button
              style={isActiveRoute("/detailsstats") ? styles.desktopNavButtonActive : styles.desktopNavButton}
              onClick={handleStatsNavigation}
              onMouseEnter={(e) => addHoverEffect(e, isActiveRoute("/detailsstats"))}
              onMouseLeave={(e) => removeHoverEffect(e, isActiveRoute("/detailsstats"))}
            >
              📈 Detailed Statistics
            </button>

            <button
              style={isActiveRoute("/admin/offers") ? styles.desktopNavButtonActive : styles.desktopNavButton}
              onClick={handleOffersNavigation}
              onMouseEnter={(e) => addHoverEffect(e, isActiveRoute("/admin/offers"))}
              onMouseLeave={(e) => removeHoverEffect(e, isActiveRoute("/admin/offers"))}
            >
              🎁 Offers Details
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NavBar;