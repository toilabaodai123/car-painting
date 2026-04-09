import { useState, useEffect } from 'react';
import './index.css';

function App() {
  const [data, setData] = useState({ orders: [], users: [], products: [] });
  const [token, setToken] = useState(localStorage.getItem('admin_token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchOrders = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/orders', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        if (res.status === 403) throw new Error('Access Denied. You do not have the ADMIN role.');
        if (res.status === 401) throw new Error('Unauthorized. Token invalid or expired.');
        throw new Error('Failed to fetch data');
      }
      const data = await res.json();
      setData({
        orders: data.orders || [],
        users: data.users || [],
        products: data.products || []
      });
      setLoading(false);
    } catch (err) {
      console.error(err);
      setError(err.message);
      setLoading(false);
      if (err.message.includes('Unauthorized') || err.message.includes('Access Denied')) {
         handleLogout();
      }
    }
  };
  const handleExport = async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await fetch('http://localhost:3000/exports/orders', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        if (res.status === 403) throw new Error('Access Denied. You do not have permission to export.');
        throw new Error('Export failed to generate.');
      }
      const data = await res.json();
      if (data.downloadUrl) {
        const a = document.createElement('a');
        a.href = data.downloadUrl;
        a.download = data.fileName || 'orders-export.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
  };


  useEffect(() => {
    fetchOrders();
  }, [token]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3001/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'password', username, password })
      });
      const resData = await res.json();
      if (!res.ok) {
        setError(resData.error || 'Login failed');
        setLoading(false);
        return;
      }
      setToken(resData.access_token);
      localStorage.setItem('admin_token', resData.access_token);
    } catch (e) {
      setError('Server connection error. Is IdP running?');
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (token) {
      try {
        await fetch('http://localhost:3000/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch (e) {
        console.warn('Token revocation failed:', e.message);
      }
    }
    setToken(null);
    localStorage.removeItem('admin_token');
    setData({ orders: [], users: [], products: [] });
  };

  const getUserName = (userId) => {
    const user = data.users.find(u => u.id === userId);
    return user ? user.name : 'Unknown User';
  };

  const getProductName = (productId) => {
    const product = data.products.find(p => p.id === productId);
    return product ? `${product.name} ($${product.price})` : 'Unknown Product';
  };

  if (!token) {
    return (
      <div className="dashboard">
        <header className="glass-header">
           <div className="logo">Nexus<span>Sync</span></div>
        </header>
        <main style={{ maxWidth: '400px', alignSelf: 'center', marginTop: '10vh' }}>
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h2>Admin Portal</h2>
            <p style={{marginBottom: '1rem', color: '#9094a6'}}>Restricted Access.</p>
            {error && <div style={{color: '#ff6b6b', background: 'rgba(255, 107, 107, 0.1)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem'}}>{error}</div>}
            
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{display: 'block', marginBottom: '0.5rem', color: '#9094a6'}}>Administrator Username</label>
                <input style={{width: '100%', padding: '0.8rem', borderRadius: '8px', border: '1px solid #333', background: 'rgba(0,0,0,0.5)', color: 'white'}} type="text" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </div>
              <div>
                <label style={{display: 'block', marginBottom: '0.5rem', color: '#9094a6'}}>Password</label>
                <input style={{width: '100%', padding: '0.8rem', borderRadius: '8px', border: '1px solid #333', background: 'rgba(0,0,0,0.5)', color: 'white'}} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <button disabled={loading} style={{padding: '0.8rem', background: '#5e6ad2', color: 'white', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer', marginTop: '1rem'}} type="submit">
                 {loading ? 'Authenticating...' : 'Sign In'}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="glass-header">
        <div className="logo">Nexus<span>Sync</span></div>
        <nav>
          <ul style={{display: 'flex', alignItems: 'center'}}>
            <li className="active">Overview</li>
            <li>Users</li>
            <li>Products</li>
            <li onClick={handleLogout} style={{fontWeight: 'bold', color: '#ff6b6b'}}>Logout</li>
          </ul>
        </nav>
      </header>

      <main>
        <div className="welcome-banner glass-panel">
          <h1>Command Center</h1>
          <p>Real-time telemetry across the cluster.</p>
        </div>

        {error && <div className="error-container"><p>{error}</p></div>}
        {loading && <div className="loader-container" style={{height: '50px'}}><div className="loader" style={{width: '30px', height: '30px'}}></div></div>}

        <div className="widgets-grid">
          <div className="widget glass-panel">
            <h3>Total Orders</h3>
            <div className="metric">{data.orders.length || 0}</div>
            <p className="trend positive">▲ 12% from last week</p>
          </div>
          <div className="widget glass-panel">
            <h3>Active Users</h3>
            <div className="metric">{data.users.length || 0}</div>
            <p className="trend positive">▲ 3% from last week</p>
          </div>
          <div className="widget glass-panel">
            <h3>Products Listed</h3>
            <div className="metric">{data.products.length || 0}</div>
            <p className="trend neutral">▶ 0% from last week</p>
          </div>
        </div>

        <section className="unified-view glass-panel">
          <div className="section-header">
            <h2>Recent Transactions</h2>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button className="primary-btn" onClick={fetchOrders}>Refresh Data</button>
              <button className="primary-btn" style={{ background: '#20c997' }} onClick={handleExport}>⬇ Export CSV</button>
            </div>
          </div>
          
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Customer</th>
                  <th>Item Purchased</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.length === 0 ? (
                  <tr><td colSpan="4" className="empty-state">No orders found.</td></tr>
                ) : (
                  data.orders.map(order => (
                    <tr key={order.id}>
                      <td className="highlight-id">#{order.id.toString().padStart(6, '0')}</td>
                      <td>
                        <div className="user-pill">{getUserName(order.userId)}</div>
                      </td>
                      <td className="item-details">{getProductName(order.productId)}</td>
                      <td><span className={`status-badge ${order.status === 'PAID' ? 'success' : order.status === 'REJECTED' ? 'danger' : 'warning'}`}>{order.status || 'PENDING'}</span></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
