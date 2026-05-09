import { useEffect, useMemo, useState } from 'react';
import './Products.css';

const STOCK = {
  AVAILABLE: 'available',
  OUT: 'out_of_stock',
};

const PRODUCTS_ENDPOINT = 'https://api.onrise.in/v2/product/all';

function formatCurrency(amount) {
  if (typeof amount !== 'number') return '₹0';
  return `₹${amount}`;
}

function StockPill({ status }) {
  const label = status === STOCK.AVAILABLE ? 'Active' : 'Out of stock';
  return <span className={`product-status ${status === STOCK.AVAILABLE ? 'active' : 'out'}`}>{label}</span>;
}

function IconButton({ title, onClick, children }) {
  return (
    <button type="button" className="product-icon-btn" onClick={onClick} title={title} aria-label={title}>
      {children}
    </button>
  );
}

export default function Products() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const editingProduct = useMemo(() => products.find(p => p.id === editingId) || null, [products, editingId]);

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await fetch(PRODUCTS_ENDPOINT, { signal: controller.signal });
        const json = await res.json();

        if (!json?.success || !Array.isArray(json?.data)) {
          throw new Error(json?.message || 'Failed to fetch products');
        }

        const mapped = json.data.map((p) => ({
          id: p.id,
          name: p.name || 'Unnamed product',
          sku: p.sku || '-',
          imageUrl: Array.isArray(p.productImages) && p.productImages.length > 0 ? p.productImages[0] : '',
          price: typeof p.discountedPrice === 'number' ? p.discountedPrice : (typeof p.basePrice === 'number' ? p.basePrice : 0),
          mrp: typeof p.basePrice === 'number' ? p.basePrice : (typeof p.discountedPrice === 'number' ? p.discountedPrice : 0),
          status: p.isActive ? STOCK.AVAILABLE : STOCK.OUT,
          badge: p.isBestSeller ? 'Best Seller' : '',
        }));

        setProducts(mapped);
      } catch (e) {
        if (e?.name === 'AbortError') return;
        setError(e?.message || 'Failed to load products');
      } finally {
        setLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, []);

  const openEdit = (id) => {
    setEditingId(id);
    setEditOpen(true);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditingId(null);
  };

  const setStock = (newStatus) => {
    if (!editingId) return;
    setProducts(prev =>
      prev.map(p => (p.id === editingId ? { ...p, status: newStatus } : p))
    );
    closeEdit();
  };

  const handleCopySku = async (sku) => {
    try {
      await navigator.clipboard.writeText(sku);
    } catch {
      // ignore clipboard failures silently
    }
  };

  return (
    <div className="products-page">
      <div className="products-header">
        <div>
          <div className="products-title">T-shirts</div>
          <div className="products-subtitle">Manage product availability</div>
        </div>
      </div>

      {loading ? <div className="products-state">Loading products...</div> : null}
      {error ? (
        <div className="products-state error">
          {error}
          <button type="button" className="products-retry" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      ) : null}

      <div className="products-grid">
        {products.map((p) => (
          <div key={p.id} className="product-card">
            <div className="product-image-wrap">
              {p.imageUrl ? (
                <img className="product-image" src={p.imageUrl} alt={p.name} loading="lazy" />
              ) : (
                <div className="product-image-fallback" aria-label="No product image" />
              )}
              {p.badge ? <div className="product-badge">{p.badge}</div> : null}
            </div>

            <div className="product-body">
              <div className="product-name" title={p.name}>{p.name}</div>
              <div className="product-sku">SKU: {p.sku}</div>

              <div className="product-row">
                <div className="product-price">
                  <span className="product-price-now">{formatCurrency(p.price)}</span>
                  <span className="product-price-mrp">{formatCurrency(p.mrp)}</span>
                </div>
                <StockPill status={p.status} />
              </div>

              <div className="product-actions">
                <IconButton title="Copy SKU" onClick={() => handleCopySku(p.sku)}>
                  ⧉
                </IconButton>
                <IconButton title="Edit stock" onClick={() => openEdit(p.id)}>
                  ✎
                </IconButton>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editOpen && editingProduct ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <div className="modal-title">Update stock status</div>
              <button type="button" className="modal-close" onClick={closeEdit} aria-label="Close">✕</button>
            </div>
            <div className="modal-body">
              <div className="modal-product">
                <div className="modal-product-name">{editingProduct.name}</div>
                <div className="modal-product-sku">SKU: {editingProduct.sku}</div>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-btn primary"
                  onClick={() => setStock(STOCK.AVAILABLE)}
                >
                  Available
                </button>
                <button
                  type="button"
                  className="modal-btn danger"
                  onClick={() => setStock(STOCK.OUT)}
                >
                  Out of stock
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

