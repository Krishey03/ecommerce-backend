// routes/shop/products-routes.js
const express = require('express');
const {
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
} = require('../../controllers/shop/products-controller');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

// ========== PUBLIC ROUTES (No login required) ==========

// Search & suggestions (must be declared BEFORE /get/:id to avoid conflict)
router.get('/search', searchProducts);
router.get('/search/suggestions', getSearchSuggestions);

router.get('/get', getProducts);
router.get('/get/:id', getProductDetails);

// ========== PROTECTED ROUTES (Login required) ==========
router.use(requireAuth);

// Cart routes
router.get('/cart/:email', getCartItems);
router.get('/cart/checkout/:buyerEmail', getCartItemsForCheckout);

// Order routes
router.get('/orders/seller/:sellerEmail', getSellerOrders);
router.get('/orders/buyer/:buyerEmail', getBuyerOrders);

// Order actions
router.patch('/orders/:orderId', updateOrderStatus);

// Buy product
router.post('/:productId/buy', buyProduct);

module.exports = router;