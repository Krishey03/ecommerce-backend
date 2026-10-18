// controllers/shop/products-controller.js
const Product = require('../../models/Product');
const Order = require('../../models/Order');
const PaymentTransaction = require('../../models/paymentTransaction');
const cache = require('../../helpers/cache');

// ========== PUBLIC ROUTES ==========

const getProducts = async (req, res) => {
    try {
        const products = await Product.find({ isSold: false });
        res.status(200).json({
            success: true,
            data: products
        });
    } catch (e) {
        console.log(e);
        res.status(500).json({
            success: false,
            message: 'Server Error'
        });
    }
};

const getProductDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const product = await Product.findById(id).lean();

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        res.status(200).json(product);
    } catch (e) {
        console.error("Product details error:", e);
        res.status(500).json({
            success: false,
            message: 'Server Error'
        });
    }
};

// ========== SEARCH & FILTER ==========

// Escape special regex characters
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /shop/products/search
 * Query params:
 *   q                - search term (searches title, author, isbn, publisher,
 *                      publicationDate, edition, seller)
 *   minPrice         - minimum price filter
 *   maxPrice         - maximum price filter
 *   sort             - 'recent' | 'priceAsc' | 'priceDesc' | 'relevance'
 *   page             - page number (default 1)
 *   limit            - results per page (default 20)
 */
const searchProducts = async (req, res) => {
    try {
        const {
            q = '',
            minPrice,
            maxPrice,
            sort = 'relevance',
            page = 1,
            limit = 20
        } = req.query;

        const trimmedQ = String(q).trim();
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const skip = (pageNum - 1) * limitNum;

        // Base query: only unsold products
        const query = { isSold: false };

        // ---- Text search ----
        if (trimmedQ) {
            const safe = escapeRegex(trimmedQ);

            // Detect "full seller name" match (hidden feature).
            // Seller names often contain spaces. If the query contains a space
            // OR the query matches a known seller name exactly (case-insensitive),
            // we'll prioritize / enforce exact seller name matching.
            const sellerExactRegex = new RegExp(`^${safe}$`, 'i');

            // Check if any product's seller matches exactly with this query
            const sellerExactExists = await Product.exists({
                seller: sellerExactRegex,
                isSold: false
            });

            if (sellerExactExists) {
                // HIDDEN FEATURE: Only match seller when the full seller name
                // is typed in the search box. Search is performed as an
                // exact, case-insensitive match on the seller field.
                query.seller = sellerExactRegex;
            } else {
                // General search across the text fields.
                // Note: seller is intentionally NOT included here so that
                // partial seller names do not return results — satisfying the
                // "hidden feature" requirement (full name required).
                const regex = new RegExp(safe, 'i');
                query.$or = [
                    { title: regex },
                    { author: regex },
                    { isbn: regex },
                    { publisher: regex },
                    { publicationDate: regex },
                    { edition: regex },
                    { description: regex }
                ];
            }
        }

        // ---- Price range filter ----
        if (minPrice !== undefined || maxPrice !== undefined) {
            const priceFilter = {};
            if (minPrice !== undefined && minPrice !== '') {
                const min = Number(minPrice);
                if (!isNaN(min) && min >= 0) priceFilter.$gte = min;
            }
            if (maxPrice !== undefined && maxPrice !== '') {
                const max = Number(maxPrice);
                if (!isNaN(max) && max >= 0) priceFilter.$lte = max;
            }
            if (Object.keys(priceFilter).length) {
                query.price = priceFilter;
            }
        }

        // ---- Sorting ----
        let sortOption = { createdAt: -1 };
        switch (sort) {
            case 'recent':
                sortOption = { createdAt: -1 };
                break;
            case 'priceAsc':
                sortOption = { price: 1 };
                break;
            case 'priceDesc':
                sortOption = { price: -1 };
                break;
            case 'relevance':
            default:
                // Relevance: title matches first, then author, then publisher, then edition
                sortOption = { createdAt: -1 };
                break;
        }

        // ---- Cache lookup (for non-relevance sort only, to keep it simple) ----
        const cacheKey = `search:${JSON.stringify({
            q: trimmedQ,
            minPrice,
            maxPrice,
            sort,
            pageNum,
            limitNum
        })}`;

        const cached = cache.get(cacheKey);
        if (cached) {
            return res.status(200).json({
                success: true,
                ...cached,
                cached: true
            });
        }

        const [products, total] = await Promise.all([
            Product.find(query)
                .sort(sortOption)
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Product.countDocuments(query)
        ]);

        // For relevance sorting, re-order in memory so that title matches
        // come first, then author, then publisher, then edition.
        let finalProducts = products;
        if (trimmedQ && sort === 'relevance') {
            const lower = trimmedQ.toLowerCase();
            finalProducts = [...products].sort((a, b) => {
                const score = (p) => {
                    const t = (p.title || '').toLowerCase();
                    const au = (p.author || '').toLowerCase();
                    const pu = (p.publisher || '').toLowerCase();
                    const ed = (p.edition || '').toLowerCase();
                    if (t.includes(lower)) return 4;
                    if (au.includes(lower)) return 3;
                    if (pu.includes(lower)) return 2;
                    if (ed.includes(lower)) return 1;
                    return 0;
                };
                return score(b) - score(a);
            });
        }

        const payload = {
            data: finalProducts,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum)
            },
            filters: {
                q: trimmedQ,
                minPrice: minPrice ?? null,
                maxPrice: maxPrice ?? null,
                sort
            }
        };

        // Cache for 30 seconds
        cache.set(cacheKey, payload, 30000);

        res.status(200).json({
            success: true,
            ...payload
        });
    } catch (e) {
        console.error("Search error:", e);
        res.status(500).json({
            success: false,
            message: 'Server Error'
        });
    }
};

/**
 * GET /shop/products/search/suggestions?q=...
 * Returns up to 5 suggestions, prioritized:
 *   Title > Author > Publisher > Edition
 */
const getSearchSuggestions = async (req, res) => {
    try {
        const { q = '' } = req.query;
        const trimmed = String(q).trim();

        if (!trimmed || trimmed.length < 2) {
            return res.status(200).json({
                success: true,
                suggestions: []
            });
        }

        const cacheKey = `suggest:${trimmed.toLowerCase()}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.status(200).json({
                success: true,
                suggestions: cached,
                cached: true
            });
        }

        const safe = escapeRegex(trimmed);
        const regex = new RegExp(safe, 'i');

        // Fetch candidate docs matching any of the suggestion fields
        const candidates = await Product.find({
            isSold: false,
            $or: [
                { title: regex },
                { author: regex },
                { publisher: regex },
                { edition: regex }
            ]
        })
            .select('title author publisher edition')
            .limit(50)
            .lean();

        // Build prioritized suggestion list
        // priority: title=0, author=1, publisher=2, edition=3
        const seen = new Set();
        const ranked = [];

        const pushSuggestion = (value, priority) => {
            if (!value) return;
            const key = String(value).toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            ranked.push({ value, priority });
        };

        for (const p of candidates) {
            if (p.title && regex.test(p.title)) pushSuggestion(p.title, 0);
        }
        for (const p of candidates) {
            if (p.author && regex.test(p.author)) pushSuggestion(p.author, 1);
        }
        for (const p of candidates) {
            if (p.publisher && regex.test(p.publisher)) pushSuggestion(p.publisher, 2);
        }
        for (const p of candidates) {
            if (p.edition && regex.test(p.edition)) pushSuggestion(p.edition, 3);
        }

        ranked.sort((a, b) => a.priority - b.priority);

        const suggestions = ranked.slice(0, 5).map(s => s.value);

        // Cache for 60 seconds
        cache.set(cacheKey, suggestions, 60000);

        res.status(200).json({
            success: true,
            suggestions
        });
    } catch (e) {
        console.error("Suggestion error:", e);
        res.status(500).json({
            success: false,
            message: 'Server Error'
        });
    }
};

// ========== PROTECTED ROUTES ==========

// Buy product (add to cart)
const buyProduct = async (req, res) => {
    try {
        const { productId } = req.params;
        const { buyerEmail } = req.body;
        const io = req.app.get('io');

        if (!buyerEmail) {
            return res.status(400).json({
                success: false,
                message: "Buyer email is required."
            });
        }

        const product = await Product.findById(productId);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found."
            });
        }

        if (product.isSold) {
            return res.status(400).json({
                success: false,
                message: "Product is already sold."
            });
        }

        if (product.sellerEmail === buyerEmail) {
            return res.status(400).json({
                success: false,
                message: "You cannot buy your own product."
            });
        }

        product.buyerEmail = buyerEmail;
        await product.save();

        // Invalidate product-related caches
        cache.clearByPrefix('search:');
        cache.clearByPrefix('suggest:');

        if (io) {
            io.emit("productUpdated", { productId: product._id });
        }

        res.status(200).json({
            success: true,
            message: "Product added to cart successfully",
            product: product
        });

    } catch (error) {
        console.error("Error buying product:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to buy product"
        });
    }
};

// Get cart items
const getCartItems = async (req, res) => {
    try {
        const { email } = req.params;
        console.log("Fetching cart items for:", email);

        const cartItems = await Product.find({
            buyerEmail: email,
            isSold: false,
            paymentStatus: { $nin: ["paid", "refunded"] }
        });

        res.status(200).json({
            success: true,
            data: cartItems
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "An error occurred while fetching cart items.",
            error: error.message
        });
    }
};

// Get cart items for checkout (with total)
const getCartItemsForCheckout = async (req, res) => {
    try {
        const { buyerEmail } = req.params;

        const products = await Product.find({
            buyerEmail: buyerEmail,
            isSold: false,
            paymentStatus: 'pending'
        });

        const total = products.reduce((sum, p) => sum + p.price, 0);

        res.status(200).json({
            success: true,
            data: products,
            total: total
        });
    } catch (error) {
        console.error("Error fetching cart items for checkout:", error);
        res.status(500).json({
            success: false,
            message: 'Server Error'
        });
    }
};

// Get seller orders
const getSellerOrders = async (req, res) => {
    try {
        const { sellerEmail } = req.params;

        const orders = await Order.find({ seller: sellerEmail })
            .populate('product')
            .populate('paymentId')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            data: orders
        });
    } catch (error) {
        console.error("Error fetching seller orders:", error);
        res.status(500).json({
            success: false,
            message: 'Server Error'
        });
    }
};

// Get buyer orders
const getBuyerOrders = async (req, res) => {
    try {
        const { buyerEmail } = req.params;

        const orders = await Order.find({ buyer: buyerEmail })
            .populate('product')
            .populate('paymentId')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            data: orders
        });
    } catch (error) {
        console.error("Error fetching buyer orders:", error);
        res.status(500).json({
            success: false,
            message: 'Server Error'
        });
    }
};

// Update order status (accept/cancel)
const updateOrderStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body;

        if (!['pending', 'accepted', 'cancelled'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Must be: pending, accepted, or cancelled'
            });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        order.status = status;
        await order.save();

        if (status === 'accepted') {
            await Product.findByIdAndUpdate(order.product, { isSold: true });
        }

        if (status === 'cancelled') {
            await Product.findByIdAndUpdate(order.product, {
                isSold: false,
                buyerEmail: null
            });
        }

        // Invalidate product caches since product state may change
        cache.clearByPrefix('search:');
        cache.clearByPrefix('suggest:');

        const io = req.app.get('io');
        if (io) {
            io.emit('orderUpdated', { orderId: order._id });
        }

        res.status(200).json({
            success: true,
            data: order
        });
    } catch (error) {
        console.error("Error updating order:", error);
        res.status(500).json({
            success: false,
            message: 'Server Error'
        });
    }
};

module.exports = {
    getProducts,
    getProductDetails,
    searchProducts,
    getSearchSuggestions,
    buyProduct,
    getCartItems,
    getCartItemsForCheckout,
    getSellerOrders,
    getBuyerOrders,
    updateOrderStatus
};