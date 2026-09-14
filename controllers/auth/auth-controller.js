const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const User = require('../../models/User');

const registerUser = async (req, res) => {
    const { userName, email, password, phone, address } = req.body;

    const trimmedUserName = userName?.trim();
    const trimmedEmail = email?.trim().toLowerCase();
    const trimmedPassword = password?.trim();
    const trimmedPhone = phone?.trim();
    const trimmedAddress = address?.trim();

    try {
        if (!trimmedUserName || !trimmedEmail || !trimmedPassword || !trimmedPhone || !trimmedAddress) {
            return res.status(400).json({
                success: false,
                message: "All fields are required.",
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmedEmail)) {
            return res.status(400).json({
                success: false,
                message: "Invalid email format.",
            });
        }

        const existingUser = await User.findOne({
            email: { $regex: new RegExp(`^${trimmedEmail}$`, 'i') }
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User with this email is already registered.",
            });
        }

        const hashPassword = await bcrypt.hash(trimmedPassword, 12);

        const newUser = new User({
            userName: trimmedUserName,
            email: trimmedEmail,
            password: hashPassword,
            phone: trimmedPhone,
            address: trimmedAddress
        });

        await newUser.save();

        return res.status(201).json({
            success: true,
            message: "User registered successfully!",
        });

    } catch (e) {
        console.error("Registration Error:", e);
        return res.status(500).json({
            success: false,
            message: "An error occurred during registration.",
        });
    }
};

const loginUser = async (req, res) => {
    const { email, password } = req.body;

    try {
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required",
            });
        }

        const emailLower = email.toLowerCase();

        const checkUser = await User.findOne({
            email: { $regex: new RegExp(`^${emailLower}$`, 'i') }
        });

        if (!checkUser) {
            return res.status(401).json({
                success: false,
                message: "User does not exist",
            });
        }

        if (checkUser.isBlocked) {
            return res.status(403).json({
                success: false,
                message: "Your account has been banned. Please contact support.",
            });
        }

        const checkPasswordMatch = await bcrypt.compare(password, checkUser.password);
        if (!checkPasswordMatch) {
            return res.status(401).json({
                success: false,
                message: "Password does not match",
            });
        }

        const token = jwt.sign(
            {
                id: checkUser.id,
                role: checkUser.role,
                email: checkUser.email,
                userName: checkUser.userName,
                isBlocked: checkUser.isBlocked
            },
            process.env.JWT_SECRET,
            // { expiresIn: process.env.JWT_EXPIRES_IN || '6000m' }
        );

        return res
            .cookie('token', token, {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                maxAge: 60 * 60 * 1000,
                path: '/',
            })
            .json({
                success: true,
                message: "Login successful",
                user: {
                    id: checkUser._id,
                    email: checkUser.email,
                    role: checkUser.role,
                    userName: checkUser.userName,
                    phone: checkUser.phone,
                    address: checkUser.address,
                },
            });

    } catch (e) {
        console.error("Login Error:", e);
        return res.status(500).json({
            success: false,
            message: "An error occurred during login.",
        });
    }
};

const logoutUser = (req, res) => {
    res.clearCookie('token').json({
        success: true,
        message: "Logged out successfully",
    });
};

const authMiddleware = async (req, res, next) => {
    const token = req.cookies.token;

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "You are not authenticated!",
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        if (user.isBlocked) {
            return res.status(403).json({
                success: false,
                message: "Access denied. Your account is banned.",
            });
        }

        req.user = user;
        next();

    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized user!",
        });
    }
};

const getUserProfile = async (req, res) => {
    try {
        const user = req.user;
        res.status(200).json({
            success: true,
            user: {
                userName: user.userName,
                email: user.email,
                phone: user.phone,
                address: user.address,
                role: user.role
            }
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            message: "An error occurred while fetching profile.",
        });
    }
};

const updateUserProfile = async (req, res) => {
    try {
        const user = req.user;
        const { userName, phone, address, currentPassword, newPassword } = req.body;

        const userToUpdate = await User.findById(user._id).select("+password");
        if (!userToUpdate) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        if (userName) userToUpdate.userName = userName;
        if (phone) userToUpdate.phone = phone;
        if (address) userToUpdate.address = address;

        if (currentPassword && newPassword) {
            const isPasswordMatch = await bcrypt.compare(currentPassword, userToUpdate.password);
            if (!isPasswordMatch) {
                return res.status(401).json({
                    success: false,
                    message: "Current password is incorrect.",
                });
            }
            userToUpdate.password = await bcrypt.hash(newPassword, 12);
        }

        await userToUpdate.save();

        res.status(200).json({
            success: true,
            message: "Profile updated successfully!",
            user: {
                userName: userToUpdate.userName,
                email: userToUpdate.email,
                phone: userToUpdate.phone,
                address: userToUpdate.address,
                role: userToUpdate.role
            }
        });
    } catch (e) {
        console.error("Profile Update Error:", e);
        res.status(500).json({
            success: false,
            message: "An error occurred while updating profile.",
        });
    }
};

module.exports = { 
    registerUser, 
    loginUser, 
    logoutUser, 
    authMiddleware, 
    getUserProfile, 
    updateUserProfile 
};