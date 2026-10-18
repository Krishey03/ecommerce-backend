const Product = require("../../models/Product");
const { getImageUrl } = require("../../helpers/upload");
const path = require('path');
const fs = require('fs');

// Upload product image (user version)
const handleUserImageUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded"
      });
    }

    const imageUrl = getImageUrl(req.file.filename);
    
    res.json({
      success: true,
      url: imageUrl,
      filename: req.file.filename
    });
  } catch(error) {
    console.log("Image upload error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred during image upload",
      error: error.message
    });
  }
};

// Add product (user version - only the user can add their own products)
const addUserProduct = async (req, res) => {
    try {
        const { 
            title, author, isbn, publisher, publicationDate, 
            edition, description, image, price, seller, 
            sellerEmail, sellerPhone 
        } = req.body;

        // Verify the logged-in user is the seller
        if (req.user.email !== sellerEmail) {
            return res.status(403).json({
                success: false,
                message: "You can only add products under your own email"
            });
        }

        const newlyCreatedProduct = new Product({
            title,
            author,
            isbn,
            publisher,
            publicationDate,
            edition,
            description,
            image,
            price,
            seller: seller || req.user.userName,
            sellerEmail: sellerEmail || req.user.email,
            sellerPhone: sellerPhone || req.user.phone,
        });

        await newlyCreatedProduct.save();
        cache.clearByPrefix('search:');
        cache.clearByPrefix('suggest:');
        
        // Notify via socket
        const io = req.app.get("io");
        if (io) {
            io.emit("newProductAdded", newlyCreatedProduct);
        }

        res.status(201).json({
            success: true,
            data: newlyCreatedProduct
        });
    } catch (e) {
        console.log(e);
        res.status(500).json({
            success: false,
            message: "An error occurred while adding the product!"
        });
    }
};

// Get user's own products
const getUserProducts = async (req, res) => {
    try {
        const userEmail = req.user.email;
        
        const products = await Product.find({ 
            sellerEmail: userEmail 
        }).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            data: products
        });
    } catch (e) {
        console.log(e);
        res.status(500).json({
            success: false,
            message: "An error occurred while fetching your products!"
        });
    }
};

// Edit user's own product
const editUserProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            title, author, isbn, publisher, publicationDate, 
            edition, description, image, price, sellerPhone 
        } = req.body;
        
        const product = await Product.findById(id);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found."
            });
        }

        // Verify the logged-in user owns this product
        if (product.sellerEmail !== req.user.email) {
            return res.status(403).json({
                success: false,
                message: "You can only edit your own products"
            });
        }

        // Update fields
        product.title = title || product.title;
        product.author = author || product.author;
        product.isbn = isbn || product.isbn;
        product.publisher = publisher || product.publisher;
        product.publicationDate = publicationDate || product.publicationDate;
        product.edition = edition || product.edition;
        product.description = description || product.description;
        product.image = image || product.image;
        product.price = price || product.price;
        product.sellerPhone = sellerPhone || product.sellerPhone;

        await product.save();
        cache.clearByPrefix('search:');
        cache.clearByPrefix('suggest:');

        res.status(200).json({
            success: true,
            data: product,
            message: "Product updated successfully!"
        });
    } catch (e) {
        console.log(e);
        res.status(500).json({
            success: false,
            message: "An error occurred while updating the product."
        });
    }
};

// Delete user's own product
const deleteUserProduct = async (req, res) => {
    try {
        const { id } = req.params;
        
        const product = await Product.findById(id);
        
        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found."
            });
        }

        // Verify the logged-in user owns this product
        if (product.sellerEmail !== req.user.email) {
            return res.status(403).json({
                success: false,
                message: "You can only delete your own products"
            });
        }

        // Delete the product image if it exists
        if (product.image) {
            const filename = path.basename(product.image);
            const imagePath = path.join(__dirname, '../../Product_Images', filename);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }

        await Product.findByIdAndDelete(id);
        cache.clearByPrefix('search:');
        cache.clearByPrefix('suggest:');

        res.status(200).json({
            success: true,
            message: "Product deleted successfully!"
        });
    } catch (e) {
        console.log(e);
        res.status(500).json({
            success: false,
            message: "An error occurred while deleting the product."
        });
    }
};

module.exports = { 
    handleUserImageUpload,
    addUserProduct,
    getUserProducts,
    editUserProduct,
    deleteUserProduct
};