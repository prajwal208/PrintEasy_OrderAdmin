import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './Products.css';

const STOCK = {
  AVAILABLE: 'available',
  OUT: 'out_of_stock',
};

const PRODUCTS_ENDPOINT = 'https://api.onrise.in/v2/product/all';
const productDetailUrl = (id) => `https://api.onrise.in/v2/product/${id}`;
const API_KEY = '454ccaf106998a71760f6729e7f9edaf1df17055b297b3008ff8b65a5efd7c10';

function authHeaders() {
  const token = localStorage.getItem('authToken');
  return {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function formatCurrency(amount) {
  if (typeof amount !== 'number') return '₹0';
  return `₹${amount}`;
}

function parseMaybeJson(val) {
  if (typeof val !== 'string') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

/** Rows where each item is a size/year tier (2–3Y) with nested measurement options (Chest, Length…). */
function isSizeTierRow(row) {
  if (!row || typeof row !== 'object') return false;
  if (!Array.isArray(row.options) || row.options.length === 0) return false;
  return row.options.every(
    (c) => c && typeof c === 'object' && c.label != null && !Array.isArray(c.options)
  );
}

function collectConfigurationOptionLists(raw) {
  const lists = [];
  const add = (arr) => {
    if (Array.isArray(arr) && arr.length) lists.push(arr);
  };

  let cfg = raw?.configuration ?? raw?.productConfiguration;
  cfg = parseMaybeJson(cfg) ?? cfg;

  if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
    add(cfg.options);
  }
  if (Array.isArray(cfg)) {
    for (const block of cfg) {
      if (block && typeof block === 'object') add(block.options);
    }
  }

  add(raw?.configurationOptions);
  add(raw?.options);
  add(raw?.metadata?.configuration?.options);
  add(raw?.sizeChart?.options);

  return lists;
}

/** Top-level size/year options (e.g. 2–3Y / 2–3y), not Chest/Length rows. */
function extractConfigSizeOptions(raw) {
  const lists = collectConfigurationOptionLists(raw);

  for (const list of lists) {
    const tiers = list.filter(isSizeTierRow);
    if (tiers.length > 0) {
      return tiers.map((row) => ({
        label: row.label != null ? String(row.label) : String(row.value ?? ''),
        value: row.value != null ? String(row.value) : String(row.label ?? ''),
      }));
    }
  }

  for (const list of lists) {
    const flat = list.filter(
      (row) =>
        row &&
        typeof row === 'object' &&
        (row.label != null || row.value != null) &&
        !Array.isArray(row.options)
    );
    if (flat.length > 0) {
      return flat.map((row) => ({
        label: row.label != null ? String(row.label) : String(row.value ?? ''),
        value: row.value != null ? String(row.value) : String(row.label ?? ''),
      }));
    }
  }

  const deepList = findNestedSizeTierOptions(raw);
  if (deepList.length > 0) {
    return deepList.map((row) => ({
      label: row.label != null ? String(row.label) : String(row.value ?? ''),
      value: row.value != null ? String(row.value) : String(row.label ?? ''),
    }));
  }

  return [];
}

const MAX_OPTION_SCAN_DEPTH = 8;

/** Last resort: locate an `options` array whose entries look like 2–3Y + Chest/Length rows. */
function findNestedSizeTierOptions(node, depth = 0, seen = new Set()) {
  if (!node || typeof node !== 'object' || depth > MAX_OPTION_SCAN_DEPTH) return [];
  if (seen.has(node)) return [];
  seen.add(node);

  if (Array.isArray(node)) {
    if (node.length > 0 && isSizeTierRow(node[0])) return node;
    for (const item of node) {
      const found = findNestedSizeTierOptions(item, depth + 1, seen);
      if (found.length) return found;
    }
    return [];
  }

  if (Array.isArray(node.options) && node.options.length > 0 && isSizeTierRow(node.options[0])) {
    return node.options;
  }

  for (const k of Object.keys(node)) {
    const found = findNestedSizeTierOptions(node[k], depth + 1, seen);
    if (found.length) return found;
  }
  return [];
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
  /** Config size `value`s that are out of stock; all others are available. Empty array = all available. */
  const [outOfStockSizeValues, setOutOfStockSizeValues] = useState([]);
  const [productStockChoice, setProductStockChoice] = useState(STOCK.AVAILABLE);
  const [editingDetail, setEditingDetail] = useState(null);
  const [editingDetailLoading, setEditingDetailLoading] = useState(false);
  const [editingDetailError, setEditingDetailError] = useState('');
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [successToast, setSuccessToast] = useState('');
  const [configMultiselectOpen, setConfigMultiselectOpen] = useState(false);
  const [multiselectListStyle, setMultiselectListStyle] = useState(null);
  const multiselectTriggerRef = useRef(null);
  const multiselectDropdownRef = useRef(null);

  const editingProduct = useMemo(() => products.find(p => p.id === editingId) || null, [products, editingId]);

  const modalSizeOptions = useMemo(() => {
    if (editingDetail) return extractConfigSizeOptions(editingDetail);
    return editingProduct?.configSizeOptions ?? [];
  }, [editingDetail, editingProduct]);

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        setLoading(true);
        setError('');
        const headers = { ...authHeaders() };
        delete headers['Content-Type'];

        const res = await fetch(PRODUCTS_ENDPOINT, { signal: controller.signal, headers });
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
          configSizeOptions: extractConfigSizeOptions(p),
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

  useEffect(() => {
    if (!editOpen || !editingId) return;

    const controller = new AbortController();
    setEditingDetail(null);
    setEditingDetailError('');
    setUpdateError('');
    setEditingDetailLoading(true);
    setConfigMultiselectOpen(false);

    (async () => {
      try {
        const detailHeaders = { ...authHeaders() };
        delete detailHeaders['Content-Type'];
        const res = await fetch(productDetailUrl(editingId), {
          signal: controller.signal,
          headers: detailHeaders,
        });
        const json = await res.json();
        if (!json?.success || !json?.data) {
          throw new Error(json?.message || 'Failed to load product');
        }
        const data = json.data;
        setEditingDetail(data);
        setProductStockChoice(data.isActive ? STOCK.AVAILABLE : STOCK.OUT);

        const opts = extractConfigSizeOptions(data);
        const bySize = new Map(
          (Array.isArray(data.sizeAvailability) ? data.sizeAvailability : []).map((row) => [
            String(row.size ?? '').trim(),
            row.status,
          ])
        );
        const oosVals = [];
        for (const o of opts) {
          const st = bySize.get(o.label.trim());
          if (st === STOCK.OUT || st === 'out_of_stock') {
            oosVals.push(o.value);
          }
        }
        setOutOfStockSizeValues(oosVals);
      } catch (e) {
        if (e?.name === 'AbortError') return;
        setEditingDetailError(e?.message || 'Failed to load product');
      } finally {
        setEditingDetailLoading(false);
      }
    })();

    return () => controller.abort();
  }, [editOpen, editingId]);

  useLayoutEffect(() => {
    if (!configMultiselectOpen || !multiselectTriggerRef.current) {
      setMultiselectListStyle(null);
      return;
    }
    const updatePlacement = () => {
      const el = multiselectTriggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 4;
      const margin = 12;
      const maxWant = 320;
      const below = window.innerHeight - r.bottom - gap - margin;
      const above = r.top - margin;
      let top = r.bottom + gap;
      let maxHeight = Math.min(maxWant, Math.max(140, below));
      if (below < 120 && above > below) {
        maxHeight = Math.min(maxWant, Math.max(140, above - gap));
        top = Math.max(margin, r.top - gap - maxHeight);
      }
      setMultiselectListStyle({
        position: 'fixed',
        top,
        left: r.left,
        width: r.width,
        maxHeight,
        zIndex: 10050,
      });
    };
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [configMultiselectOpen, editingId]);

  useEffect(() => {
    if (!configMultiselectOpen) return;
    const onDocMouseDown = (e) => {
      const t = multiselectTriggerRef.current;
      const d = multiselectDropdownRef.current;
      if (t?.contains(e.target)) return;
      if (d?.contains(e.target)) return;
      setConfigMultiselectOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [configMultiselectOpen]);

  useEffect(() => {
    if (!successToast) return;
    const id = window.setTimeout(() => setSuccessToast(''), 4000);
    return () => window.clearTimeout(id);
  }, [successToast]);

  const openEdit = (id) => {
    setEditingId(id);
    setEditOpen(true);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditingId(null);
    setConfigMultiselectOpen(false);
    setEditingDetail(null);
    setEditingDetailError('');
    setUpdateError('');
    setEditingDetailLoading(false);
  };

  const toggleOutOfStockSize = (value) => {
    setOutOfStockSizeValues((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const handleUpdateProduct = async () => {
    if (!editingId || !editingDetail) return;
    setUpdateLoading(true);
    setUpdateError('');
    try {
      const opts = extractConfigSizeOptions(editingDetail);
      const sizeAvailability = opts.map((o) => ({
        size: o.label,
        status: outOfStockSizeValues.includes(o.value) ? STOCK.OUT : STOCK.AVAILABLE,
      }));
      const payload = {
        ...editingDetail,
        isActive: productStockChoice === STOCK.AVAILABLE,
        sizeAvailability,
      };

      const res = await fetch(productDetailUrl(editingId), {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      let json = {};
      try {
        const t = await res.text();
        if (t) json = JSON.parse(t);
      } catch {
        json = {};
      }
      if (!res.ok) {
        throw new Error(json?.message || res.statusText || 'Update failed');
      }
      if (json?.success === false) {
        throw new Error(json?.message || 'Update failed');
      }

      const nextDetail = json?.data ?? payload;
      setEditingDetail(nextDetail);

      setProducts((prev) =>
        prev.map((p) =>
          p.id === editingId
            ? {
                ...p,
                status: productStockChoice,
                name: nextDetail.name ?? p.name,
                sku: nextDetail.sku ?? p.sku,
                price:
                  typeof nextDetail.discountedPrice === 'number'
                    ? nextDetail.discountedPrice
                    : typeof nextDetail.basePrice === 'number'
                      ? nextDetail.basePrice
                      : p.price,
                mrp: typeof nextDetail.basePrice === 'number' ? nextDetail.basePrice : p.mrp,
                configSizeOptions: extractConfigSizeOptions(nextDetail),
              }
            : p
        )
      );
      setSuccessToast('Product updated successfully.');
      closeEdit();
    } catch (e) {
      setUpdateError(e?.message || 'Update failed');
    } finally {
      setUpdateLoading(false);
    }
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
      {successToast ? (
        <div className="products-toast" role="status" aria-live="polite">
          {successToast}
        </div>
      ) : null}
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

              {editingDetailLoading ? (
                <div className="modal-detail-loading">Loading product…</div>
              ) : null}
              {editingDetailError ? (
                <div className="modal-detail-error">{editingDetailError}</div>
              ) : null}
              {updateError ? <div className="modal-update-error">{updateError}</div> : null}

              <div className="modal-field">
                <div className="modal-field-label" id="config-sizes-label">
                  Size availability
                </div>
                <div className="modal-field-hint">
                  Checked = <code>out_of_stock</code>; unchecked = <code>available</code>. Empty API list starts with all unchecked (all available).
                </div>
                {!editingDetailLoading && !editingDetailError && modalSizeOptions?.length ? (
                  <>
                    <button
                      ref={multiselectTriggerRef}
                      type="button"
                      className="modal-multiselect-trigger"
                      disabled={!editingDetail}
                      aria-expanded={configMultiselectOpen}
                      aria-haspopup="listbox"
                      aria-labelledby="config-sizes-label"
                      onClick={() => editingDetail && setConfigMultiselectOpen((o) => !o)}
                    >
                      <span className="modal-multiselect-trigger-text">
                        {outOfStockSizeValues.length
                          ? outOfStockSizeValues
                              .map((v) => modalSizeOptions.find((o) => o.value === v)?.label ?? v)
                              .join(', ')
                          : 'All sizes available'}
                      </span>
                      <span className="modal-multiselect-chevron" aria-hidden>
                        {configMultiselectOpen ? '▴' : '▾'}
                      </span>
                    </button>
                    {configMultiselectOpen && multiselectListStyle && editingDetail
                      ? createPortal(
                          <ul
                            ref={multiselectDropdownRef}
                            className="modal-multiselect-list modal-multiselect-list-portal"
                            style={multiselectListStyle}
                            role="listbox"
                            aria-multiselectable="true"
                            aria-labelledby="config-sizes-label"
                          >
                            {modalSizeOptions.map((opt) => {
                              const isOos = outOfStockSizeValues.includes(opt.value);
                              return (
                                <li key={opt.value} role="option" aria-selected={isOos}>
                                  <label className="modal-multiselect-option">
                                    <input
                                      type="checkbox"
                                      checked={isOos}
                                      onChange={() => toggleOutOfStockSize(opt.value)}
                                    />
                                    <span>{opt.label}</span>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>,
                          document.body
                        )
                      : null}
                  </>
                ) : null}
                {!editingDetailLoading && !editingDetailError && editingDetail && !modalSizeOptions?.length ? (
                  <div className="modal-multiselect-empty">
                    No configuration sizes on this product from the API.
                  </div>
                ) : null}
              </div>

              <div className="modal-field-label modal-field-label-spaced" id="product-stock-label">
                Product status
              </div>
              <div className="modal-actions modal-stock-row">
                <button
                  type="button"
                  className={`modal-btn primary ${productStockChoice === STOCK.AVAILABLE ? 'choice-selected' : 'choice-dim'}`}
                  disabled={!editingDetail || editingDetailLoading}
                  onClick={() => setProductStockChoice(STOCK.AVAILABLE)}
                  aria-pressed={productStockChoice === STOCK.AVAILABLE}
                  aria-labelledby="product-stock-label"
                >
                  Available
                </button>
                <button
                  type="button"
                  className={`modal-btn danger ${productStockChoice === STOCK.OUT ? 'choice-selected' : 'choice-dim'}`}
                  disabled={!editingDetail || editingDetailLoading}
                  onClick={() => setProductStockChoice(STOCK.OUT)}
                  aria-pressed={productStockChoice === STOCK.OUT}
                  aria-labelledby="product-stock-label"
                >
                  Out of stock
                </button>
              </div>

              <div className="modal-update-wrap">
                <button
                  type="button"
                  className="modal-btn update-submit"
                  disabled={!editingDetail || editingDetailLoading || updateLoading || !!editingDetailError}
                  onClick={handleUpdateProduct}
                >
                  {updateLoading ? 'Updating…' : 'Update'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

