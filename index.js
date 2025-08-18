require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const stripe = require("stripe")(process.env.STRIPE_SK);
const { getPetRecommendations, getAdvancedPetRecommendations } = require("./petRecommendations");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
const corsOptions = {
    origin: ["http://localhost:5173", "http://localhost:5174", "https://adoptipet.web.app"],
    credentials: true,
    optionSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());

const uri = process.env.MONGODB_URI;

const verifyToken = async (req, res, next) => {
    const token = req.cookies?.token;

    if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
    }
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ message: "unauthorized access" });
        }
        req.user = decoded;
        next();
    });
};

// MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        const db = client.db("AdoptiPetDB");
        const usersCollection = db.collection("users");
        const petCollection = db.collection("allPets");
        const adoptRequestsCollection = db.collection("adoptRequests");
        const donationsCollection = db.collection("donationsCollection");
        const recievedDonationCollection = db.collection("recievedDonationCollection");
        const reviewsCollection = db.collection("reviews");

        //Admin Verification
        const verifyAdmin = async (req, res, next) => {
            const email = req?.user?.email;
            const user = await usersCollection.findOne({
                email,
            });
            if (!user || user?.role !== "admin")
                return res.status(403).send({ message: "Only Admins can Access this!", role: user?.role });

            next();
        };

        // Allow both user and admin
        const verifyUserOrAdmin = async (req, res, next) => {
            const email = req?.user?.email;
            const user = await usersCollection.findOne({ email });
            if (!user || (user?.role !== "user" && user?.role !== "admin")) {
                return res.status(403).send({ message: "Access denied!", role: user?.role });
            }
            next();
        };

        //generate jwt
        app.post("/jwt", (req, res) => {
            const email = req.body.email;

            if (!email) {
                return res.status(400).send({ success: false, message: "Email is required" });
            }

            //token creation
            const accessToken = jwt.sign({ email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "20d" });
            res.cookie("token", accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
            }).send({ success: true });
        });
        // Logout
        app.get("/logout", async (req, res) => {
            try {
                res.clearCookie("token", {
                    maxAge: 0,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
                }).send({ success: true });
            } catch (err) {
                res.status(500).send(err);
            }
        });

        // GET API all users for admin
        app.get("/all-users", verifyToken, verifyAdmin, async (req, res) => {
            const filter = {
                email: {
                    $ne: req?.user?.email,
                },
            };
            const result = await usersCollection.find(filter).toArray();
            res.send(result);
        });

        // GET API for fetching a user's role
        app.get("/user/role/:email", async (req, res) => {
            const email = req.params.email;
            const result = await usersCollection.findOne({ email });
            if (!result) return res.status(404).send({ message: "User Not Found." });
            res.send({ role: result?.role });
        });

        // GET API for fetching a user's profile data
        app.get("/user/profile/:email", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const email = req.params.email;
            try {
                const user = await usersCollection.findOne({ email });
                if (!user) {
                    return res.status(404).send({ success: false, message: "User not found" });
                }
                // Remove sensitive information before sending
                const { password, ...userProfile } = user;
                res.send({ success: true, user: userProfile });
            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Failed to fetch user profile",
                    error: error.message,
                });
            }
        });

        // PATCH API for updating user profile data
        app.patch("/user/profile/:email", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const email = req.params.email;
            const updateData = req.body;
            
            try {
                // Only allow updating specific fields
                const allowedFields = ['name', 'profilepic'];
                const filteredData = {};
                
                allowedFields.forEach(field => {
                    if (updateData[field] !== undefined) {
                        filteredData[field] = updateData[field];
                    }
                });
                
                if (Object.keys(filteredData).length === 0) {
                    return res.status(400).send({ success: false, message: "No valid fields to update" });
                }
                
                const result = await usersCollection.updateOne(
                    { email },
                    { $set: { ...filteredData, last_updated: new Date().toISOString() } }
                );
                
                if (result.matchedCount === 0) {
                    return res.status(404).send({ success: false, message: "User not found" });
                }
                
                res.send({ success: true, message: "Profile updated successfully", result });
            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Failed to update profile",
                    error: error.message,
                });
            }
        });

        // save or update a users info in db
        app.post("/user", async (req, res) => {
            const userData = req.body;
            userData.role = "user";
            userData.created_at = new Date().toISOString();
            userData.last_loggedIn = new Date().toISOString();
            const query = {
                email: userData?.email,
            };
            const userExists = await usersCollection.findOne(query);

            if (!!userExists) {
                const result = await usersCollection.updateOne(query, {
                    $set: { last_loggedIn: new Date().toISOString() },
                });
                return res.send(result);
            }

            const result = await usersCollection.insertOne(userData);
            res.send(result);
        });

        // PATCH Api endpoint for updating a user's role
        app.patch("/user/role-update/:email", verifyToken, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const { role } = req.body;
            const filter = { email: email };
            const updateRole = {
                $set: {
                    role,
                },
            };
            const result = await usersCollection.updateOne(filter, updateRole);
            res.send(result);
        });

        // POST API endpoint for Adding a pet
        app.post("/add-pet", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const pet = req.body;
            pet.created_at = new Date().toISOString();
            const result = await petCollection.insertOne(pet);
            res.send(result);
        });

        const paginateCollection = require("./utils/pagination__collection.js");

        // GET API endpoint for Retrieving All pets with pagination
        app.get("/all-pets", async (req, res) => {
            const filter = { adopted: false };

            const { category, search } = req.query;
            if (category) {
                const normalize = (str) => str?.toString().toLowerCase().replace(/\s|_/g, "").trim();
                const catNorm = normalize(category);
                filter.$expr = {
                    $eq: [
                        {
                            $replaceAll: {
                                input: {
                                    $replaceAll: { input: { $toLower: "$category" }, find: "_", replacement: "" },
                                },
                                find: " ",
                                replacement: "",
                            },
                        },
                        catNorm,
                    ],
                };
            }
            if (search) {
                filter.pet_name = { $regex: search, $options: "i" };
            }

            const result = await paginateCollection({ collection: petCollection, req, filter });
            res.send({
                pets: result.items,
                nextId: result.nextId,
                previousId: result.previousId,
                total: result.total,
            });
        });

        // GET API endpoint for retrieving a single pet by ID
        app.get("/pet-detail/:id", async (req, res) => {
            const { id } = req.params;
            const { ObjectId } = require("mongodb");
            if (!ObjectId.isValid(id)) {
                return res.status(400).send({ success: false, message: "Invalid pet ID" });
            }
            try {
                const pet = await petCollection.findOne({ _id: new ObjectId(id) });
                if (!pet) {
                    return res.status(404).send({ success: false, message: "Pet not found" });
                }
                res.send(pet);
            } catch (error) {
                res.status(500).send({ success: false, message: "Failed to fetch pet", error: error.message });
            }
        });

        // GET API endpoint for pets by category
        app.get("/category-pets", async (req, res) => {
            const { category } = req.query;
            if (!category) {
                return res.status(400).send({ success: false, message: "Category is required" });
            }
            try {
                // Use case-insensitive regex for category match
                const filter = {
                    category: { $regex: `^${category}$`, $options: "i" },
                    adopted: false,
                };

                const result = await paginateCollection({ collection: petCollection, req, filter });
                res.send({
                    pets: result.items,
                    nextId: result.nextId,
                    previousId: result.previousId,
                    total: result.total,
                });
            } catch (error) {
                res.status(500).send({ success: false, message: "Failed to fetch pets", error: error.message });
            }
        });

        // GET API endpoint for pet recommendations
        app.get("/pet-recommendations", verifyToken, getPetRecommendations(petCollection));

        // GET API endpoint for advanced pet recommendations
        app.get("/pet-recommendations/advanced", verifyToken, getAdvancedPetRecommendations(petCollection));

        // POST API endpoint for submitting an adoption request
        app.post("/adopt-request", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const request = req.body;
            if (!request.pet_id || !request.user_email) {
                return res.status(400).send({ success: false, message: "pet_id and user_email are required" });
            }
            try {
                request.requested_at = new Date().toISOString();
                request.adopted = false;
                request.adoption_status = "pending";
                const result = await adoptRequestsCollection.insertOne(request);
                res.send({ success: true, result });
            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Failed to submit adoption request",
                    error: error.message,
                });
            }
        });

        // GET API endpoint to check if already requested for adoption
        app.get("/adopt-request/check", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const { pet_id, user_email } = req.query;
            if (!pet_id || !user_email) {
                return res.status(400).send({ success: false, message: "pet_id and user_email are required" });
            }
            try {
                // Check if already adopted
                const pet = await petCollection.findOne({
                    _id: require("mongodb").ObjectId.createFromHexString(pet_id),
                });
                // Prevent user from requesting adoption for their own pet
                if (pet && pet.added_by && pet.added_by.email === user_email) {
                    return res.send({ alreadyRequested: true, adopted: false, ownPet: true });
                }
                if (pet && pet.adopted === true) {
                    return res.send({ alreadyRequested: true, adopted: true, ownPet: false });
                }
                // Check if already requested
                const alreadyRequested = await adoptRequestsCollection.findOne({ pet_id, user_email });
                res.send({ alreadyRequested: !!alreadyRequested, adopted: false, ownPet: false });
            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Failed to check adoption request",
                    error: error.message,
                });
            }
        });

        // get all pet added by user using email
        app.get("/dashboard/my-added-pets/:email", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { "added_by.email": email };
            const result = await petCollection.find(filter).toArray();
            res.send(result);
        });

        // PATCH API endpoint to update pet data
        app.patch("/pet-update/:id", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const id = req.params.id;
            const userEmail = req.user.email;
            const updateData = req.body;
            const filter = { _id: new ObjectId(id), "added_by.email": userEmail };
            // Spread the updateData fields directly into $set
            const update = { $set: { ...updateData, last_updated: new Date().toISOString() } };
            const result = await petCollection.updateOne(filter, update);
            res.send(result);
        });

        // DELETE API endpoint to delete a pet by its ID
        app.delete("/dashboard/my-added-pets/:id", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const id = req.params.id;
            const userEmail = req.user.email;
            if (!ObjectId.isValid(id)) {
                return res.status(400).send({ success: false, message: "Invalid pet ID" });
            }
            try {
                // Only Allow delete if the pet was added by the user
                const filter = { _id: new ObjectId(id), "added_by.email": userEmail };
                const result = await petCollection.deleteOne(filter);
                if (result.deletedCount === 0) {
                    return res.status(404).send({ success: false, message: "Pet not found or not authorized" });
                }
                res.send({ success: true, message: "Pet deleted successfully" });
            } catch (error) {
                res.status(500).send({ success: false, message: "Failed to delete pet", error: error.message });
            }
        });

        // GET API to get all adoption requests for pets added by user
        app.get("/dashboard/adoption-requests/:email", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { "added_by.email": email };
            const result = await adoptRequestsCollection.find(filter).toArray();
            res.send(result);
        });

        // Patch API for updating adoption request of pets.
        app.patch("/adoption-request-update/:id", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const id = req.params.id;
            const { adoption_status } = req.body;
            const filter = { _id: new ObjectId(id) };

            // Find the request to get pet_id
            const requestDoc = await adoptRequestsCollection.findOne(filter);
            let adoptedValue = false;
            if (adoption_status === "accepted") {
                adoptedValue = true;
            }

            // Update adoption_status and adopted in adoptRequestsCollection
            const update = {
                $set: {
                    adoption_status,
                    adopted: adoptedValue,
                    last_updated: new Date().toISOString(),
                },
            };
            const requestUpdate = await adoptRequestsCollection.updateOne(filter, update);

            // Update adopted field in petCollection
            if (requestDoc && id) {
                await petCollection.updateOne({ _id: new ObjectId(id) }, { $set: { adopted: adoptedValue } });
            }

            res.send(requestUpdate);
        });

        // Patch API for updating adoption status of pets.
        app.patch("/adopt-status-update/:id", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const id = req.params.id;
            const { adopted } = req.body || {};
            const userEmail = req.user.email;
            const filter = { _id: new ObjectId(id), "added_by.email": userEmail };

            let adoptedValue = false;
            if (adopted === true) {
                adoptedValue = true;
            }

            // Update adopted field in petCollection
            const update = {
                $set: {
                    adopted: adoptedValue,
                    last_updated: new Date().toISOString(),
                },
            };
            try {
                const statusUpdate = await petCollection.updateOne(filter, update);

                // Only update adoptRequestsCollection if pet_id exists
                const requestExists = await adoptRequestsCollection.findOne({ pet_id: id });
                let requestUpdate = null;
                if (requestExists) {
                    requestUpdate = await adoptRequestsCollection.updateMany(
                        { pet_id: id },
                        {
                            $set: {
                                adopted: adoptedValue,
                                adoption_status: "accepted",
                                last_updated: new Date().toISOString(),
                            },
                        }
                    );
                }
                res.send({ petUpdate: statusUpdate, adoptionRequestUpdate: requestUpdate });
            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Failed to update adoption status",
                    error: error.message,
                });
            }
        });

        // POST API endpoint for creating a donation campaign
        app.post("/dashboard/create-donation-campaign", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const donation = req.body;
            donation.created_at = new Date().toISOString();
            donation.paused = false;
            const result = await donationsCollection.insertOne(donation);
            res.send(result);
        });

        // GET API for campaign data by user email
        app.get("/dashboard/my-campaign-data/:email", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { "added_by.email": email };
            const result = await donationsCollection.find(filter).toArray();
            res.send(result);
        });

        // GET API for single campaign data using id
        app.get("/donation-campaign-data/:id", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const result = await donationsCollection.findOne(filter);
            res.send(result);
        });

        // PATCH API endpoint to update donation campaign data
        app.patch("/update-donation-campaign/:id", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;
            const filter = { _id: new ObjectId(id) };
            // Spread the updatedData fields directly into $set
            const update = { $set: { ...updatedData, last_updated: new Date().toISOString() } };
            const result = await donationsCollection.updateOne(filter, update);
            res.send(result);
        });

        // GET API endpoint for Retrieving All donation campaigns with pagination (for infinite scrolling)
        app.get("/donation-campaigns", async (req, res) => {
            const result = await paginateCollection({ collection: donationsCollection, req });
            res.send({
                donations: result.items,
                nextId: result.nextId,
                previousId: result.previousId,
                total: result.total,
            });
        });

        // GET API endpoint for retrieving a single campaign detail by ID
        app.get("/donation-detail/:id", async (req, res) => {
            const { id } = req.params;
            if (!ObjectId.isValid(id)) {
                return res.status(400).send({ success: false, message: "Invalid Donation ID" });
            }
            try {
                const donation = await donationsCollection.findOne({ _id: new ObjectId(id) });
                if (!donation) {
                    return res.status(404).send({ success: false, message: "Donation Campaign not found" });
                }
                res.send(donation);
            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Failed to fetch donation campaign",
                    error: error.message,
                });
            }
        });

        app.post("/create-payment-intent", async (req, res) => {
            const { _id, amount } = req.body;
            if (!ObjectId.isValid(_id)) {
                return res.status(400).send({ success: false, message: "Invalid Campaign ID" });
            }
            if (!amount || isNaN(amount) || Number(amount) <= 0) {
                return res.status(400).send({ success: false, message: "Invalid amount" });
            }
            try {
                const donCampaign = await donationsCollection.findOne({ _id: new ObjectId(_id) });
                if (!donCampaign) {
                    return res.status(404).send({ success: false, message: "Donation Campaign not found" });
                }
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: Math.round(Number(amount) * 100),
                    currency: "usd",
                    automatic_payment_methods: {
                        enabled: true,
                    },
                });
                res.send({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Failed to create payment intent",
                    error: error.message,
                });
            }
        });

        // POST API endpoint to store received donation details after successful checkout
        app.post("/recieved-donation", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const { campaign_id, amount_donated, user_name, email, profilepic, pet_image, pet_name } = req.body;
            if (!campaign_id || !ObjectId.isValid(campaign_id) || !amount_donated || !user_name || !email) {
                return res.status(400).send({ success: false, message: "Required fields missing or invalid." });
            }
            try {
                const donationDoc = {
                    campaign_id: new ObjectId(campaign_id),
                    amount_donated: Number(amount_donated),
                    user_name,
                    pet_image: pet_image,
                    email,
                    pet_name: pet_name,
                    profilepic: profilepic || null,
                    donated_at: new Date().toISOString(),
                };
                const result = await recievedDonationCollection.insertOne(donationDoc);

                // Sum all donations for this campaign
                const agg = await recievedDonationCollection
                    .aggregate([
                        { $match: { campaign_id: new ObjectId(campaign_id) } },
                        { $group: { _id: "$campaign_id", total: { $sum: "$amount_donated" } } },
                    ])
                    .toArray();
                const totalDonations = agg.length > 0 ? agg[0].total : 0;
                // Update campaign total_donations field
                await donationsCollection.updateOne(
                    { _id: new ObjectId(campaign_id) },
                    { $set: { total_donations: totalDonations } }
                );

                res.send({ success: true, result, total_donations: totalDonations });
            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Failed to store donation details",
                    error: error.message,
                });
            }
        });

        // GET API endpoint to fetch donors for a specific campaign
        app.get("/dashboard/donors-list/:campaignId", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const campaignId = req.params.campaignId;
            if (!ObjectId.isValid(campaignId)) {
                return res.status(400).send([]);
            }
            const filter = { campaign_id: new ObjectId(campaignId) };
            const donors = await recievedDonationCollection.find(filter).toArray();
            res.send(donors);
        });

        // GET api endpoint to fetch donations added by user using email
        app.get("/dashboard/my-donations/:email", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await recievedDonationCollection.find(filter).toArray();
            res.send(result);
        });

        // DELETE API endpoint to delete a donation by ID
        app.delete("/dashboard/donation-delete/:id", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const id = req.params.id;
            const userEmail = req.user.email;
            if (!ObjectId.isValid(id)) {
                return res.status(400).send({ success: false, message: "Invalid pet ID" });
            }
            try {
                // Only Allow delete if the pet was added by the user
                const filter = { _id: new ObjectId(id), email: userEmail };
                const result = await recievedDonationCollection.deleteOne(filter);
                if (result.deletedCount === 0) {
                    return res
                        .status(404)
                        .send({ success: false, message: "No Donation with this Id found or Authorization Failed" });
                }
                res.send({ success: true, message: "Refunded successfully" });
            } catch (error) {
                res.status(500).send({ success: false, message: "Failed to Refund", error: error.message });
            }
        });

        // GET API endpoint for Retrieving All pets (Admin Only)
        app.get("/admin/all-pets", verifyToken, verifyAdmin, async (req, res) => {
            try {
                const result = await petCollection.find().toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to retrieve pets", error: error.message });
            }
        });

        // DELETE API endpoint to delete a pet by its ID (Admin Only)
        app.delete("/admin/all-pets/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) {
                return res.status(400).send({ success: false, message: "Invalid pet ID" });
            }
            try {
                const result = await petCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) {
                    return res.status(404).send({ success: false, message: "Pet not found or not authorized" });
                }
                res.send({ success: true, message: "Pet deleted successfully" });
            } catch (error) {
                res.status(500).send({ success: false, message: "Failed to delete pet", error: error.message });
            }
        });

        // Patch API for updating adoption status of pets.
        app.patch("/admin/adopt-status-update/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const { adopted, adoption_status } = req.body || {};
            const filter = { _id: new ObjectId(id) };

            let adoptedValue = false;
            if (adopted === true) {
                adoptedValue = true;
            }

            // Determine adoption_status to set in adoptRequestsCollection
            let statusToSet = adoption_status;
            if (!statusToSet) {
                statusToSet = adoptedValue ? "accepted" : "pending";
            }

            // Update adopted field in petCollection
            const update = {
                $set: {
                    adopted: adoptedValue,
                    last_updated: new Date().toISOString(),
                },
            };
            try {
                const statusUpdate = await petCollection.updateOne(filter, update);

                // Only update adoptRequestsCollection if pet_id exists
                const requestExists = await adoptRequestsCollection.findOne({ pet_id: id });
                let requestUpdate = null;
                if (requestExists) {
                    requestUpdate = await adoptRequestsCollection.updateMany(
                        { pet_id: id },
                        {
                            $set: {
                                adopted: adoptedValue,
                                adoption_status: statusToSet,
                                last_updated: new Date().toISOString(),
                            },
                        }
                    );
                }
                res.send({ petUpdate: statusUpdate, adoptionRequestUpdate: requestUpdate });
            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Failed to update adoption status",
                    error: error.message,
                });
            }
        });

        // DELETE API endpoint to delete a pet by its ID
        app.delete("/admin/dashboard/delete-pet/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) {
                return res.status(400).send({ success: false, message: "Invalid pet ID" });
            }
            try {
                // Only Allow delete if the pet was added by the user
                const filter = { _id: new ObjectId(id) };
                const result = await petCollection.deleteOne(filter);
                if (result.deletedCount === 0) {
                    return res.status(404).send({ success: false, message: "Pet not found or not authorized" });
                }
                res.send({ success: true, message: "Pet deleted successfully" });
            } catch (error) {
                res.status(500).send({ success: false, message: "Failed to delete pet", error: error.message });
            }
        });

        // GET API endpoint for Retrieving All Donations by User (Admin Only)
        app.get("/admin/dashboard/all-donations", verifyToken, verifyAdmin, async (req, res) => {
            try {
                const result = await donationsCollection.find().toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to retrieve donations", error: error.message });
            }
        });

        // DELETE API endpoint to delete a Donation Campaign by its ID (Admin Only)
        app.delete("/admin/delete-donation-campaign/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) {
                return res.status(400).send({ success: false, message: "Invalid donation camapign ID" });
            }
            try {
                const result = await donationsCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) {
                    return res
                        .status(404)
                        .send({ success: false, message: "Donation Campaign not found or not authorized" });
                }
                res.send({ success: true, message: "Donation Campaign deleted successfully" });
            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Failed to delete Donation Campaign",
                    error: error.message,
                });
            }
        });

        // PATCH API endpoint to update Donation Campaign by Admin
        app.patch("/admin/update-donation-campaign/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;
            const filter = { _id: new ObjectId(id) };
            // Spread the updatedData fields directly into $set
            const update = { $set: { ...updatedData, last_updated: new Date().toISOString() } };
            const result = await donationsCollection.updateOne(filter, update);
            res.send(result);
        });

        // GET API endpoint to check if user has already submitted a review
        app.get("/check-user-review/:email", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const email = req.params.email;
            if (!email) {
                return res.status(400).send({ success: false, message: "Email is required" });
            }
            try {
                const existingReview = await reviewsCollection.findOne({
                    userEmail: email,
                    status: "active"
                });
                res.send({
                    success: true,
                    hasReviewed: !!existingReview,
                    review: existingReview || null
                });
            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Failed to check user review",
                    error: error.message,
                });
            }
        });

        // POST API endpoint for submitting a review
        app.post("/submit-review", verifyToken, verifyUserOrAdmin, async (req, res) => {
            const review = req.body;
            if (!review.rating || !review.comment || !review.userId || !review.userEmail) {
                return res.status(400).send({ success: false, message: "Rating, comment, userId, and userEmail are required" });
            }
            try {
                // Check if user has already submitted a review
                const existingReview = await reviewsCollection.findOne({
                    userEmail: review.userEmail,
                    status: "active"
                });
                
                if (existingReview) {
                    return res.status(409).send({
                        success: false,
                        message: "You have already submitted a review. Only one review per user is allowed."
                    });
                }

                review.created_at = new Date().toISOString();
                review.status = "active"; // Reviews are active by default
                const result = await reviewsCollection.insertOne(review);
                res.send({ success: true, result });
            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Failed to submit review",
                    error: error.message,
                });
            }
        });

        // GET API endpoint for retrieving all reviews with pagination
        app.get("/reviews", async (req, res) => {
            try {
                const { page = 1, limit = 10, status = "active" } = req.query;
                const skip = (parseInt(page) - 1) * parseInt(limit);

                const filter = { status };

                const reviews = await reviewsCollection
                    .find(filter)
                    .sort({ created_at: -1 })
                    .skip(skip)
                    .limit(parseInt(limit))
                    .toArray();

                const total = await reviewsCollection.countDocuments(filter);

                res.send({
                    reviews,
                    pagination: {
                        currentPage: parseInt(page),
                        totalPages: Math.ceil(total / parseInt(limit)),
                        totalReviews: total,
                        hasNextPage: skip + parseInt(limit) < total,
                        hasPrevPage: parseInt(page) > 1,
                    },
                });
            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Failed to fetch reviews",
                    error: error.message,
                });
            }
        });

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
    }
}
run();

// Basic route
app.get("/", (req, res) => {
    res.send("AdoptiPet Server is running!");
});

// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
