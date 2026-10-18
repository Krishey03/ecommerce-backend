const Product = require("../../models/Product");
const { getImageUrl } = require("../../helpers/upload");
const cache = require('../../helpers/cache');

const handleImageUpload = async(req, res) => {
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

const addProduct = async (req, res) => {
    try {
        const { 
            title, author, isbn, publisher, publicationDate, 
            edition, description, image, price, seller, 
            sellerEmail, sellerPhone 
        } = req.body;

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
            seller,
            sellerEmail,
            sellerPhone,
        });

        await newlyCreatedProduct.save();
        cache.clearByPrefix('search:');
        cache.clearByPrefix('suggest:');

        const io = req.app.get("io");
        io.emit("newProductAdded", newlyCreatedProduct);

        res.status(201).json({
            success: true,
            data: newlyCreatedProduct
        });
    } catch (e) {
        console.log(e);
        res.status(500).json({
            success: false,
            message: "An error occurred!"
        });
    }
};

const fetchAllProducts = async(req,res)=>{
    try{
        const listOfProducts = await Product.find({ isSold: false });
        res.status(200).json({
            success: true,
            data: listOfProducts
        })
    }catch(e){
        console.log(e)
        res.status(500).json({
            success: false,
            message: "An error occured!"
        })
    }
}

const editProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            title, author, isbn, publisher, publicationDate, 
            edition, description, image, price, seller, 
            sellerEmail, sellerPhone 
        } = req.body;
        
        const findProduct = await Product.findById(id);
        cache.clearByPrefix('search:');
        cache.clearByPrefix('suggest:');

        if (!findProduct) {
            return res.status(404).json({
                success: false,
                message: "Product not found.",
            });
        }

        findProduct.title = title || findProduct.title;
        findProduct.author = author || findProduct.author;
        findProduct.isbn = isbn || findProduct.isbn;
        findProduct.publisher = publisher || findProduct.publisher;
        findProduct.publicationDate = publicationDate || findProduct.publicationDate;
        findProduct.edition = edition || findProduct.edition;
        findProduct.description = description || findProduct.description;
        findProduct.image = image || findProduct.image;
        findProduct.seller = seller || findProduct.seller;
        findProduct.sellerEmail = sellerEmail || findProduct.sellerEmail;
        findProduct.sellerPhone = sellerPhone || findProduct.sellerPhone;
        findProduct.price = price || findProduct.price;

        await findProduct.save();

        res.status(200).json({
            success: true,
            data: findProduct,
        });
    } catch (e) {
        console.log(e);
        res.status(500).json({
            success: false,
            message: "An error occurred while updating the product.",
        });
    }
};

const deleteProduct = async(req,res)=>{
    try{
        const {id} = req.params
        const product = await Product.findByIdAndDelete(id)
        if(!product) return res.status(404).json({
            success:false,
            message:"Product not found.",
        })

        res.status(200).json({
            success: true,
            message: "Product has been deleted!"
        })
    }catch(e){
        console.log(e)
        res.status(500).json({
            success: false,
            message: "An error occured!"
        })
    }
}

const getCartItems = async (req, res) => {
    try {
        const userEmail = req.user.email;
        const cartItems = await Product.find({ 
            buyerEmail: userEmail,
            isSold: false,
            paymentStatus: 'pending'
        });
        res.status(200).json({
            success: true,
            data: cartItems
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            message: "An error occurred while fetching the cart items."
        });
    }
};

const getAllExchanges = async (req, res) => {
    res.status(200).json({
        success: true,
        data: []
    });
};
  
const deleteExchange = async (req, res) => {
    res.status(200).json({
        success: true,
        message: "Exchange functionality removed"
    });
};

module.exports = { 
    handleImageUpload, 
    addProduct, 
    editProduct, 
    deleteProduct, 
    fetchAllProducts, 
    getCartItems, 
    getAllExchanges, 
    deleteExchange 
};