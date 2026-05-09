import { useState, useEffect } from 'react';
import { generatePDF, generateCombinedPDF } from '../utils/pdfGenerator';
import './Orders.css';

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [groupedOrders, setGroupedOrders] = useState({});
  const [generatingPDF, setGeneratingPDF] = useState({});
  const [pdfDownloadCount, setPdfDownloadCount] = useState(1);
  const [downloadingAll, setDownloadingAll] = useState({});
  const [downloadProgress, setDownloadProgress] = useState({});

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        'https://api.onrise.in/v1/orders/all?categoryId=H8SZ4VfsFXa4C9cUeonB&status=confirmed'
      );
      
      const data = await response.json();
      
      if (data.success && data.data) {
        setOrders(data.data);
        // Group orders by date
        const grouped = groupOrdersByDate(data.data);
        setGroupedOrders(grouped);
      } else {
        setError('Failed to fetch orders');
      }
    } catch (err) {
      setError('Error loading orders: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const groupOrdersByDate = (ordersList) => {
    const grouped = {};
    ordersList.forEach((order) => {
      const date = new Date(order.orderDate);
      const dateKey = date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: '2-digit'
      });
      
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(order);
    });
    return grouped;
  };

  const formatCurrency = (amount) => {
    return `₹ ${amount}`;
  };

  const truncateText = (text, maxLength) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const handleDownloadPDF = async (order) => {
    if (generatingPDF[order.orderId]) return; // Prevent multiple clicks for same order
    
    const currentCount = pdfDownloadCount;
    setPdfDownloadCount(currentCount + 1);
    setGeneratingPDF(prev => ({ ...prev, [order.orderId]: currentCount }));
    
    try {
      console.log('Generating PDF for order:', order.orderId);
      await generatePDF(order);
      console.log('PDF generated successfully');
    } catch (err) {
      console.error('PDF generation error:', err);
      alert('Error generating PDF: ' + (err.message || 'Unknown error. Please check the console for details.'));
    } finally {
      setGeneratingPDF(prev => {
        const newState = { ...prev };
        delete newState[order.orderId];
        return newState;
      });
    }
  };

  const handleDownloadAllForDate = async (date) => {
    const ordersForDate = groupedOrders[date] || [];
    if (ordersForDate.length === 0) return;

    // Prevent multiple clicks
    if (downloadingAll[date]) return;

    setDownloadingAll(prev => ({ ...prev, [date]: true }));
    
    // Calculate total items across all orders for progress tracking
    const totalItems = ordersForDate.reduce((sum, order) => sum + order.items.length, 0);
    setDownloadProgress(prev => ({ ...prev, [date]: { current: 0, total: totalItems } }));

    try {
      // Generate combined PDF with progress tracking
      await generateCombinedPDF(
        ordersForDate,
        date,
        (current, total) => {
          setDownloadProgress(prev => ({
            ...prev,
            [date]: { current, total }
          }));
        }
      );
    } catch (err) {
      console.error('Error downloading combined PDF:', err);
      alert('Error downloading PDF: ' + (err.message || 'Unknown error'));
    } finally {
      setDownloadingAll(prev => {
        const newState = { ...prev };
        delete newState[date];
        return newState;
      });
      setDownloadProgress(prev => {
        const newState = { ...prev };
        delete newState[date];
        return newState;
      });
    }
  };

  if (loading) {
    return (
      <div className="orders-container">
        <div className="loading">Loading orders...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="orders-container">
        <div className="error">{error}</div>
        <button onClick={fetchOrders} className="retry-button">Retry</button>
      </div>
    );
  }

  return (
    <div className="orders-container">
      <header className="orders-header">
        <h1>Orders</h1>
      </header>

      <div className="orders-content">
        {Object.keys(groupedOrders).map((date) => (
          <div key={date} className="date-section">
            <div className="date-header">
              <span className="date-text">{date}</span>
              <div className="date-header-actions">
                {downloadingAll[date] && downloadProgress[date] ? (
                  <div className="download-progress-container">
                    <div className="download-progress-bar">
                      <div 
                        className="download-progress-fill"
                        style={{ 
                          width: `${(downloadProgress[date].current / downloadProgress[date].total) * 100}%` 
                        }}
                      ></div>
                    </div>
                    <span className="download-progress-text">
                      {downloadProgress[date].current} / {downloadProgress[date].total}
                    </span>
                  </div>
                ) : (
                  <button
                    className="download-all-button"
                    onClick={() => handleDownloadAllForDate(date)}
                    disabled={downloadingAll[date]}
                    title={`Download all ${groupedOrders[date]?.length || 0} orders for ${date}`}
                  >
                    Download All ({groupedOrders[date]?.length || 0})
                  </button>
                )}
              </div>
            </div>
            
            <div className="orders-grid">
              {groupedOrders[date].map((order) => (
                <div key={order.orderId} className="order-card">
                  <div className="order-card-header">
                    <span className="items-count">{order.items.length} items</span>
                    <button
                      className="pdf-button"
                      onClick={() => handleDownloadPDF(order)}
                      title="Download PDF"
                      disabled={generatingPDF[order.orderId]}
                    >
                      {generatingPDF[order.orderId] ? (
                        <div className="pdf-downloading">
                          <div className="pdf-spinner"></div>
                          <span className="pdf-badge downloading">
                            Downloading PDF {generatingPDF[order.orderId]}
                          </span>
                        </div>
                      ) : (
                        <span className="pdf-badge">PDF</span>
                      )}
                    </button>
                  </div>
                  
                  <div className="order-description">
                    {truncateText(order.items[0]?.name || 'Order', 50)}
                  </div>
                  
                  <div className="order-price">
                    {formatCurrency(order.totalAmount)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {orders.length === 0 && (
          <div className="no-orders">No orders found</div>
        )}
      </div>
    </div>
  );
};

export default Orders;
