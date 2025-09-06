import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";


const NavBar = ({ adminUser, logoutAdmin }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Handle screen size changes
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
      if (window.innerWidth > 768) {
        setMobileMenuOpen(false);
      }
    };

    handleResize(); // Initial check
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Check if current route is active
  const isActiveRoute = (path) => {
    return location.pathname === path;
  };

  const styles = {
    // Main navbar container
    navbar: {
      backgroundColor: "#ffffff",
      position: "sticky",
      top: 0,
      zIndex: 1000,
      marginBottom: "0px",
    },

    // Desktop header styles
    header: {
      padding: "0px 0px",
    },
    headerTop: {
      display: "flex",
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
      borderBottom: "1px solid #e2e8f0",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: {
      fontSize: "32px",
      fontWeight: "bold",
      margin: 0,
      color: "#1e293b",
    },
    rightSection: {
      display: "flex",
      alignItems: "center",
      gap: "16px",
    },

    // Navigation buttons container for desktop
    navButtonsContainer: {
      display: "flex",
      gap: "22px",
      marginTop: "30px",
      marginBottom: '40px'
    },

    // Mobile header styles
    mobileHeader: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 16px",
    },
    mobileTitle: {
      fontSize: "20px",
      fontWeight: "bold",
      margin: 0,
      color: "#1e293b",
    },
    mobileMenuButton: {
      padding: "8px",
      backgroundColor: "transparent",
      border: "1px solid #e2e8f0",
      borderRadius: "6px",
      cursor: "pointer",
      fontSize: "18px",
      color: "#374151",
      transition: "all 0.2s ease",
    },

    // Mobile menu overlay
    mobileMenuOverlay: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      zIndex: 999,
      display: mobileMenuOpen ? "block" : "none",
    },

    // Mobile menu content
    mobileMenu: {
      position: "fixed",
      top: 0,
      right: mobileMenuOpen ? 0 : "-300px",
      width: "280px",
      minHeight: "100vh",
      backgroundColor: "#ffffff",
      boxShadow: "-2px 0 10px rgba(0, 0, 0, 0.1)",
      zIndex: 1000,
      transition: "right 0.3s ease",
      display: "flex",
      flexDirection: "column",
    },

    mobileMenuHeader: {
      padding: "20px",
      borderBottom: "1px solid #e2e8f0",
      backgroundColor: "#f8fafc",
    },

    mobileMenuContent: {
      flex: 1,
      padding: "20px",
      display: "flex",
      flexDirection: "column",
      gap: "16px",
    },

    mobileCloseButton: {
      position: "absolute",
      top: "16px",
      right: "16px",
      padding: "8px",
      backgroundColor: "transparent",
      border: "none",
      fontSize: "20px",
      color: "#6b7280",
      cursor: "pointer",
    },

    // User info styles
    userInfoBox: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      padding: "12px 16px",
      backgroundColor: "#f8fafc",
      borderRadius: "8px",
      border: "1px solid #e2e8f0",
    },
    userIcon: {
      fontSize: "16px",
    },
    userName: {
      fontSize: "14px",
      fontWeight: "600",
      color: "#1e293b",
      margin: 0,
    },

    // Button styles
    navButton: {
      padding: "12px 16px",
      backgroundColor: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "all 0.2s ease",
      textAlign: "center",
      color: "#374151",
      width: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
    },

    // Active state for mobile nav buttons
    navButtonActive: {
      padding: "12px 16px",
      backgroundColor: "#3b82f6",
      border: "1px solid #3b82f6",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "all 0.2s ease",
      textAlign: "center",
      color: "#ffffff",
      width: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
    },

    desktopNavButton: {
      padding: "10px 16px",
      backgroundColor: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "all 0.2s ease",
      textAlign: "center",
      color: "#374151",
    },

    // Active state for desktop nav buttons
    desktopNavButtonActive: {
      padding: "10px 16px",
      backgroundColor: "#3b82f6",
      border: "1px solid #3b82f6",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "all 0.2s ease",
      textAlign: "center",
      color: "#ffffff",
    },

    logoutButton: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
      padding: "12px 16px",
      backgroundColor: "#fee2e2",
      border: "1px solid #fecaca",
      borderRadius: "8px",
      color: "#dc2626",
      fontSize: "14px",
      fontWeight: "500",
      cursor: "pointer",
      transition: "all 0.2s ease",
      width: "100%",
    },

    desktopLogoutButton: {
      marginRight: '20px',
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "10px 16px",
      backgroundColor: "#fee2e2",
      border: "1px solid #fecaca",
      borderRadius: "8px",
      color: "#dc2626",
      fontSize: "14px",
      fontWeight: "500",
      cursor: "pointer",
      transition: "all 0.2s ease",
    },

    logoutIcon: {
      fontSize: "16px",

    },

    // Menu item styles for mobile
    mobileMenuItem: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      padding: "12px 16px",
      borderRadius: "8px",
      cursor: "pointer",
      transition: "all 0.2s ease",
      color: "#374151",
      fontSize: "14px",
      fontWeight: "500",
      border: "1px solid #e2e8f0",
      backgroundColor: "#ffffff",
    },

    // Active state for mobile menu items
    mobileMenuItemActive: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      padding: "12px 16px",
      borderRadius: "8px",
      cursor: "pointer",
      transition: "all 0.2s ease",
      color: "#ffffff",
      fontSize: "14px",
      fontWeight: "500",
      border: "1px solid #3b82f6",
      backgroundColor: "#3b82f6",
    },

    menuItemIcon: {
      fontSize: "16px",
      width: "20px",
      textAlign: "center",
    },
    logoImgStyle: {
      height: 'auto',
      width: '80px',
      marginTop: '0px',
      marginLeft: '20px'
    },

  };

    const handleOffersNavigation = () => {
    try {
      navigate("/admin/offers");
      setMobileMenuOpen(false);
    } catch (error) {
      console.error("Navigation error:", error);
      alert("Error navigating to statistics page");
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
      console.log("Logout button clicked");
      const confirmLogout = window.confirm("Are you sure you want to logout?");

      if (confirmLogout) {
        if (typeof logoutAdmin === 'function') {
          await logoutAdmin();
          navigate("/adminsignin");
          setMobileMenuOpen(false);
        } else {
          console.error("logoutAdmin is not a function:", typeof logoutAdmin);
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

  // Debug component props
  useEffect(() => {
    console.log("NavBar Props Debug:");
    console.log("adminUser:", adminUser);
    console.log("logoutAdmin:", logoutAdmin);
    console.log("isMobile:", isMobile);
    console.log("Current path:", location.pathname);
  }, [adminUser, logoutAdmin, isMobile, location.pathname]);

  return (
    <div style={styles.navbar}>
      {isMobile ? (
        // Mobile Layout
        <>
          <div style={styles.mobileHeader}>

            <button
              style={styles.mobileMenuButton}
              onClick={toggleMobileMenu}
              onMouseEnter={(e) => {
                e.target.style.backgroundColor = "#f3f4f6";
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundColor = "transparent";
              }}
            >
              ☰
            </button>
          </div>

          {/* Mobile Menu Overlay */}
          <div
            style={styles.mobileMenuOverlay}
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Mobile Menu */}
          <div style={styles.mobileMenu}>
            <button
              style={styles.mobileCloseButton}
              onClick={() => setMobileMenuOpen(false)}
            >
              ✕
            </button>

            <div style={styles.mobileMenuHeader}>
              <div style={styles.userInfoBox}>
                <div style={styles.userIcon}>👤</div>
                <div>
                  <div style={styles.userName}>
                    {adminUser?.username || adminUser?.name || "Admin"}
                  </div>
                </div>
              </div>
            </div>

            <div style={styles.mobileMenuContent}>
              {/* Dashboard Button */}
              <button
                style={isActiveRoute("/usershowpage") ? styles.mobileMenuItemActive : styles.mobileMenuItem}
                onClick={handleDashboardNavigation}
                onMouseEnter={(e) => {
                  if (!isActiveRoute("/usershowpage")) {
                    e.target.style.backgroundColor = "#f8fafc";
                    e.target.style.borderColor = "#3b82f6";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActiveRoute("/usershowpage")) {
                    e.target.style.backgroundColor = "#ffffff";
                    e.target.style.borderColor = "#e2e8f0";
                  }
                }}
              >
                <span style={styles.menuItemIcon}>📊</span>
                <span>Dashboard</span>
              </button>

              {/* Statistics Button */}
              <button
                style={isActiveRoute("/detailsstats") ? styles.mobileMenuItemActive : styles.mobileMenuItem}
                onClick={handleStatsNavigation}
                onMouseEnter={(e) => {
                  if (!isActiveRoute("/detailsstats")) {
                    e.target.style.backgroundColor = "#f8fafc";
                    e.target.style.borderColor = "#3b82f6";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActiveRoute("/detailsstats")) {
                    e.target.style.backgroundColor = "#ffffff";
                    e.target.style.borderColor = "#e2e8f0";
                  }
                }}
              >
                <span style={styles.menuItemIcon}>📈</span>
                <span>Detailed Statistics</span>
              </button>


              <button
                style={isActiveRoute("/admin/offers") ? styles.mobileMenuItemActive : styles.mobileMenuItem}
                onClick={handleOffersNavigation}
                onMouseEnter={(e) => {
                  if (!isActiveRoute("/admin/offers")) {
                    e.target.style.backgroundColor = "#f8fafc";
                    e.target.style.borderColor = "#3b82f6";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActiveRoute("/detailsstats")) {
                    e.target.style.backgroundColor = "#ffffff";
                    e.target.style.borderColor = "#e2e8f0";
                  }
                }}
              >
                <span style={styles.menuItemIcon}>📈</span>
                <span>Offers Details</span>
              </button>
              {/* Spacer */}
              <div style={{ flex: 1 }} />

              {/* Logout Button */}
              <button
                style={styles.logoutButton}
                onClick={handleLogout}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = "#fecaca";
                  e.target.style.borderColor = "#f87171";
                  e.target.style.color = "#b91c1c";
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = "#fee2e2";
                  e.target.style.borderColor = "#fecaca";
                  e.target.style.color = "#dc2626";
                }}
              >
                <span style={styles.logoutIcon}>🚪</span>
                <span>Logout</span>
              </button>
            </div>
          </div>
        </>
      ) : (
        // Desktop Layout
        <div style={styles.header}>
          <div style={styles.headerTop}>
            <img src="./Images/Logo.png" alt="LOGO" style={styles.logoImgStyle} />
            <div style={styles.rightSection}>
              {/* User Info Box */}
              <div style={styles.userInfoBox}>
                <div style={styles.userIcon}>👤</div>
                <div>
                  <div style={styles.userName}>
                    {adminUser?.username || adminUser?.name || "Admin"}
                  </div>
                </div>
              </div>

              {/* Logout Button */}
              <button
                style={styles.desktopLogoutButton}
                onClick={handleLogout}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = "#fecaca";
                  e.target.style.borderColor = "#f87171";
                  e.target.style.color = "#b91c1c";
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = "#fee2e2";
                  e.target.style.borderColor = "#fecaca";
                  e.target.style.color = "#dc2626";
                }}
              >
                <span style={styles.logoutIcon}>🚪</span>
                <span>Logout</span>
              </button>
            </div>
          </div>

          {/* Navigation Buttons Container */}
          <div style={styles.navButtonsContainer}>
            {/* Dashboard Button */}
            <button
              style={isActiveRoute("/usershowpage") ? styles.desktopNavButtonActive : styles.desktopNavButton}
              onClick={handleDashboardNavigation}
              onMouseEnter={(e) => {
                if (!isActiveRoute("/usershowpage")) {
                  e.target.style.backgroundColor = "#f8fafc";
                  e.target.style.transform = "translateY(-2px)";
                  e.target.style.boxShadow = "0 8px 15px -3px rgba(0, 0, 0, 0.1)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActiveRoute("/usershowpage")) {
                  e.target.style.backgroundColor = "#ffffff";
                  e.target.style.transform = "translateY(0)";
                  e.target.style.boxShadow = "none";
                }
              }}
            >
              User dashboard
            </button>

            {/* Statistics Button */}
            <button
              style={isActiveRoute("/detailsstats") ? styles.desktopNavButtonActive : styles.desktopNavButton}
              onClick={handleStatsNavigation}
              onMouseEnter={(e) => {
                if (!isActiveRoute("/detailsstats")) {
                  e.target.style.backgroundColor = "#f8fafc";
                  e.target.style.transform = "translateY(-2px)";
                  e.target.style.boxShadow = "0 8px 15px -3px rgba(0, 0, 0, 0.1)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActiveRoute("/detailsstats")) {
                  e.target.style.backgroundColor = "#ffffff";
                  e.target.style.transform = "translateY(0)";
                  e.target.style.boxShadow = "none";
                }
              }}
            >
              Detailed statistics
            </button>
            <button
                style={isActiveRoute("/admin/offers") ? styles.mobileMenuItemActive : styles.mobileMenuItem}
                onClick={handleOffersNavigation}
                onMouseEnter={(e) => {
                  if (!isActiveRoute("/admin/offers")) {
                    e.target.style.backgroundColor = "#f8fafc";
                    e.target.style.borderColor = "#3b82f6";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActiveRoute("/detailsstats")) {
                    e.target.style.backgroundColor = "#ffffff";
                    e.target.style.borderColor = "#e2e8f0";
                  }
                }}
              >
                <span style={styles.menuItemIcon}>📈</span>
                <span>Offers Details</span>
              </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NavBar;