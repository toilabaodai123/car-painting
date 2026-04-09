import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './index.css';

const REALTIME_URL = 'http://localhost:3003';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [userId, setUserId] = useState(null);
  const [username, setUsername] = useState('Alice');
  const [password, setPassword] = useState('password123');
  const [products, setProducts] = useState([]);
  const [loginError, setLoginError] = useState('');
  const [message, setMessage] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [isMfaStep, setIsMfaStep] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [registerMfaEnabled, setRegisterMfaEnabled] = useState(false);
  const [isForgotStep, setIsForgotStep] = useState(false);
  const [isResetStep, setIsResetStep] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Order tracking state
  const [currentOrder, setCurrentOrder] = useState(null); // { orderId, status, checkoutUrl }
  const socketRef = useRef(null);

  // Parse JWT to get userId
  useEffect(() => {
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUserId(payload.sub);
      } catch (e) {
        console.error('Failed to parse token', e);
      }
    }
  }, [token]);

  // Connect Socket.IO when we have a userId
  useEffect(() => {
    if (!userId) return;

    const socket = io(REALTIME_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Socket.IO connected:', socket.id);
      socket.emit('join', userId);
    });

    socket.on('order-status-update', (data) => {
      console.log('Real-time status update:', data);
      setCurrentOrder(prev => {
        if (prev && prev.orderId === data.orderId) {
          return { ...prev, status: data.status };
        }
        return prev;
      });
    });

    socket.on('disconnect', () => {
      console.log('Socket.IO disconnected');
    });

    return () => {
      socket.disconnect();
    };
  }, [userId]);

  const fetchProducts = async () => {
    try {
      const res = await fetch('http://localhost:3000/products');
      const data = await res.json();
      setProducts(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('http://localhost:3001/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          grant_type: 'password', 
          username, 
          password,
          client_id: 'storefront-client',
          client_secret: 'secret123'
        })
      });
      const data = await res.json();
      if (res.status === 202 && data.mfa_required) {
        setIsMfaStep(true);
        setMfaToken(data.mfa_token);
        return;
      }
      if (!res.ok) {
        setLoginError(data.error || 'Login failed');
        return;
      }
      setToken(data.access_token);
      localStorage.setItem('token', data.access_token);
      if (data.refresh_token) {
        localStorage.setItem('refresh_token', data.refresh_token);
      }
    } catch (e) {
      setLoginError('Server connection error. Is IdP running?');
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('http://localhost:3000/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username, 
          password,
          name: registerName,
          email: registerEmail,
          mfa_enabled: registerMfaEnabled
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || 'Registration failed');
        return;
      }
      setIsRegistering(false);
      await handleLogin(e);
    } catch (e) {
      setLoginError('Server connection error.');
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('http://localhost:3001/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          grant_type: 'mfa', 
          mfa_token: mfaToken,
          code: mfaCode,
          client_id: 'storefront-client',
          client_secret: 'secret123'
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error_description || 'Invalid MFA code');
        return;
      }
      setIsMfaStep(false);
      setToken(data.access_token);
      localStorage.setItem('token', data.access_token);
      if (data.refresh_token) {
        localStorage.setItem('refresh_token', data.refresh_token);
      }
    } catch (e) {
      setLoginError('Server connection error.');
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('http://localhost:3000/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      if (!res.ok) {
        const data = await res.json();
        setLoginError(data.error || 'Failed to request reset');
        return;
      }
      setIsForgotStep(false);
      setIsResetStep(true);
      setMessage('If the username exists, a reset code was sent. Check Docker logs.');
    } catch (e) {
      setLoginError('Server connection error.');
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('http://localhost:3000/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, code: resetCode, new_password: newPassword })
      });
      if (!res.ok) {
        const data = await res.json();
        setLoginError(data.error || 'Failed to reset password');
        return;
      }
      setIsResetStep(false);
      setResetCode('');
      setNewPassword('');
      setPassword('');
      setMessage('Password reset completely! Please log in now.');
    } catch (e) {
      setLoginError('Server connection error.');
    }
  };

  const handleLogout = async () => {
    // Revoke the token server-side (Redis blacklist)
    const refreshToken = localStorage.getItem('refresh_token');
    if (token) {
      try {
        await fetch('http://localhost:3000/auth/logout', {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ refresh_token: refreshToken })
        });
      } catch (e) {
        console.warn('Token revocation failed:', e.message);
      }
    }
    setToken(null);
    setUserId(null);
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    setCurrentOrder(null);
  };

  const buyProduct = async (productId) => {
    setMessage('');
    try {
      const res = await fetch('http://localhost:3000/orders', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ productId })
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        setLoginError('Session expired. Please login again.');
        return;
      }
      if (!res.ok) {
        setMessage('Purchase failed.');
        return;
      }
      const data = await res.json();

      // Set current order and navigate to order tracking view
      setCurrentOrder({
        orderId: data.orderId,
        status: data.status || 'PENDING',
        checkoutUrl: data.checkoutUrl
      });

      // Watch this specific order
      if (socketRef.current) {
        socketRef.current.emit('watch-order', data.orderId);
      }

      // Open Stripe checkout in a new tab
      if (data.checkoutUrl) {
        window.open(data.checkoutUrl, '_blank');
      }

    } catch (e) {
      setMessage('Network error during purchase.');
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'PAID': return '#2ecc71';
      case 'REJECTED': return '#e74c3c';
      default: return '#f39c12';
    }
  };

  const getStatusIcon = (status) => {
    switch(status) {
      case 'PAID': return '✅';
      case 'REJECTED': return '❌';
      default: return '⏳';
    }
  };

  const startForgotFlow = () => {
    setIsRegistering(false);
    setIsForgotStep(true);
    setLoginError('');
    setMessage('');
  };

  const cancelForgotFlow = () => {
    setIsForgotStep(false);
    setIsResetStep(false);
    setLoginError('');
    setMessage('');
  };

  // Order tracking view
  if (currentOrder) {
    return (
      <div className="storefront">
        <header className="glass-header">
          <div className="logo">Nexus<span>Customer</span></div>
          <nav>
            <button className="secondary-btn" onClick={() => setCurrentOrder(null)}>← Back to Shop</button>
          </nav>
        </header>

        <main>
          <div className="order-tracking glass-panel" style={{ maxWidth: '500px', margin: '5vh auto', padding: '2.5rem', textAlign: 'center' }}>
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>
              {getStatusIcon(currentOrder.status)}
            </div>
            <h2 style={{ marginBottom: '0.5rem' }}>Order #{currentOrder.orderId}</h2>
            <div style={{
              display: 'inline-block',
              padding: '0.5rem 1.5rem',
              borderRadius: '20px',
              fontWeight: 'bold',
              fontSize: '1.1rem',
              color: 'white',
              background: getStatusColor(currentOrder.status),
              marginBottom: '1.5rem'
            }}>
              {currentOrder.status}
            </div>

            {currentOrder.status === 'PENDING' && (
              <div>
                <p style={{ color: '#9094a6', marginBottom: '1.5rem' }}>
                  Waiting for payment confirmation...<br/>
                  <small>This page will update automatically when Stripe confirms your payment.</small>
                </p>
                <div className="pulse-dot" style={{
                  width: '12px', height: '12px', borderRadius: '50%',
                  background: '#f39c12', margin: '0 auto 1rem',
                  animation: 'pulse 1.5s ease-in-out infinite'
                }}></div>
                {currentOrder.checkoutUrl && (
                  <a href={currentOrder.checkoutUrl} target="_blank" rel="noopener noreferrer" 
                     className="primary-btn" style={{ display: 'inline-block', textDecoration: 'none', marginTop: '1rem' }}>
                    Complete Payment on Stripe →
                  </a>
                )}
              </div>
            )}

            {currentOrder.status === 'PAID' && (
              <div>
                <p style={{ color: '#2ecc71', fontWeight: 'bold', marginBottom: '1rem' }}>
                  Payment confirmed! Your order is complete.
                </p>
                <button className="primary-btn" onClick={() => setCurrentOrder(null)}>
                  Continue Shopping
                </button>
              </div>
            )}

            {currentOrder.status === 'REJECTED' && (
              <div>
                <p style={{ color: '#e74c3c', marginBottom: '1rem' }}>
                  Payment was declined or cancelled.
                </p>
                <button className="primary-btn" onClick={() => setCurrentOrder(null)}>
                  Try Again
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="storefront">
      <header className="glass-header">
        <div className="logo">Nexus<span>Customer</span></div>
        <nav>
          {token ? (
            <button className="secondary-btn" onClick={handleLogout}>Sign Out</button>
          ) : (
            <span>Welcome Guest</span>
          )}
        </nav>
      </header>

      <main>
        {message && <div className="toast">{message}</div>}

        {!token ? (
          <div className="auth-container glass-panel">
            <h2>
              {isResetStep ? 'Verify & Reset Password' : 
               isForgotStep ? 'Forgot Password' : 
               isMfaStep ? 'Two-Factor Authentication' : 
               isRegistering ? 'Create Account' : 'Secure Sign In'}
            </h2>
            {loginError && <div className="error">{loginError}</div>}
            
            {isResetStep ? (
              <form onSubmit={handleReset}>
                 <p style={{ marginBottom: '1rem', color: '#ccc', textAlign: 'center', lineHeight: '1.4' }}>
                  Please enter the reset code securely generated in the Docker logs.
                </p>
                <div className="form-group">
                  <label>Reset Code</label>
                  <input type="text" value={resetCode} onChange={e => setResetCode(e.target.value)} required placeholder="123456" />
                </div>
                <div className="form-group">
                  <label>New Password</label>
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
                </div>
                <button type="submit" className="primary-btn full-width">Complete Reset</button>
                <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                  <button type="button" className="secondary-btn" onClick={cancelForgotFlow}>Cancel</button>
                </div>
              </form>
            ) : isForgotStep ? (
              <form onSubmit={handleForgot}>
                <p style={{ marginBottom: '1rem', color: '#ccc', textAlign: 'center', lineHeight: '1.4' }}>
                  Enter your exact username to initiate a password reset workflow.
                </p>
                <div className="form-group">
                  <label>Username</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)} required />
                </div>
                <button type="submit" className="primary-btn full-width">Send Reset Code</button>
                <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                  <button type="button" className="secondary-btn" onClick={cancelForgotFlow}>Cancel</button>
                </div>
              </form>
            ) : isMfaStep ? (
              <form onSubmit={handleMfaSubmit}>
                <p style={{ marginBottom: '1rem', color: '#ccc', textAlign: 'center', lineHeight: '1.4' }}>
                  An OTP has been generated for your account. Please check the Docker logs and enter it below.
                </p>
                <div className="form-group">
                  <label>MFA Code</label>
                  <input type="text" value={mfaCode} onChange={e => setMfaCode(e.target.value)} required placeholder="123456" />
                </div>
                <button type="submit" className="primary-btn full-width">Verify & Sign In</button>
                <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                  <button type="button" className="secondary-btn" onClick={() => setIsMfaStep(false)}>Cancel</button>
                </div>
              </form>
            ) : (
              <form onSubmit={isRegistering ? handleRegister : handleLogin}>
                {isRegistering && (
                  <>
                    <div className="form-group">
                      <label>Full Name</label>
                      <input type="text" value={registerName} onChange={e => setRegisterName(e.target.value)} required />
                    </div>
                    <div className="form-group">
                      <label>Email</label>
                      <input type="email" value={registerEmail} onChange={e => setRegisterEmail(e.target.value)} required />
                    </div>
                    <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input type="checkbox" id="mfaCheck" checked={registerMfaEnabled} onChange={e => setRegisterMfaEnabled(e.target.checked)} style={{ width: 'auto' }} />
                      <label htmlFor="mfaCheck" style={{ marginBottom: 0 }}>Enable Two-Factor Authentication</label>
                    </div>
                  </>
                )}
                <div className="form-group">
                <label>Username</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
              <button type="submit" className="primary-btn full-width">
                {isRegistering ? 'Sign Up' : 'Sign In'}
              </button>
            </form>
            )}
            {!isMfaStep && !isForgotStep && !isResetStep && (
              <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                <button type="button" className="secondary-btn" onClick={() => setIsRegistering(!isRegistering)}>
                  {isRegistering ? 'Already have an account? Sign In' : 'Need an account? Sign Up'}
                </button>
                <br/>
                {!isRegistering && (
                  <button type="button" className="secondary-btn" style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#aaa' }} onClick={startForgotFlow}>
                    Forgot Password?
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="products-view">
            <div className="welcome-banner glass-panel">
              <h1>Available Products</h1>
              <p>Browse and purchase securely using your digital identity.</p>
            </div>
            
            <div className="products-grid">
              {products.map(p => (
                <div key={p.id} className="product-card glass-panel">
                  <div className="product-image">📦</div>
                  <h3>{p.name}</h3>
                  <div className="price">${p.price}</div>
                  <button onClick={() => buyProduct(p.id)} className="primary-btn">Buy Now</button>
                </div>
              ))}
              {products.length === 0 && <p>No products loaded.</p>}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
