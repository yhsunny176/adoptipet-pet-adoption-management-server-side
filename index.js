require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const stripe = require("stripe")(process.env.STRIPE_SK);

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

        // POST API endpoint for Adding a pet
        app.post("/add-pet", verifyToken, async (req, res) => {
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

        // POST API endpoint for submitting an adoption request
        app.post("/adopt-request", verifyToken, async (req, res) => {
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
        app.get("/adopt-request/check", verifyToken, async (req, res) => {
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
        app.get("/dashboard/my-added-pets/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const filter = { "added_by.email": email };
            const result = await petCollection.find(filter).toArray();
            res.send(result);
        });

        // PATCH API endpoint to update pet data
        app.patch("/pet-update/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const updateData = req.body;
            const filter = { _id: new ObjectId(id) };
            // Spread the updateData fields directly into $set
            const update = { $set: { ...updateData, last_updated: new Date().toISOString() } };
            const result = await petCollection.updateOne(filter, update);
            res.send(result);
        });

        // DELETE API endpoint to delete a pet by its ID
        app.delete("/dashboard/my-added-pets/:id", verifyToken, async (req, res) => {
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
        app.get("/dashboard/adoption-requests/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const filter = { "added_by.email": email };
            const result = await adoptRequestsCollection.find(filter).toArray();
            res.send(result);
        });

        // Patch API for updating adoption status of pets.
        app.patch("/adoption-request-update/:id", verifyToken, async (req, res) => {
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

        // POST API endpoint for creating a donation campaign
        app.post("/dashboard/create-donation-campaign", verifyToken, async (req, res) => {
            const donation = req.body;
            donation.created_at = new Date().toISOString();
            donation.paused = false;
            const result = await donationsCollection.insertOne(donation);
            res.send(result);
        });

        // GET API for campaign data by user email
        app.get("/dashboard/my-campaign-data/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const filter = { "added_by.email": email };
            const result = await donationsCollection.find(filter).toArray();
            res.send(result);
        });

        // GET API for single campaign data using id
        app.get("/donation-campaign-data/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const result = await donationsCollection.findOne(filter);
            res.send(result);
        });

        // PATCH API endpoint to update pet data
        app.patch("/update-donation-campaign/:id", verifyToken, async (req, res) => {
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
        app.post("/recieved-donation", verifyToken, async (req, res) => {
            const { campaign_id, amount_donated, user_name, email, profilepic, pet_image } = req.body;
            if (!campaign_id || !ObjectId.isValid(campaign_id) || !amount_donated || !user_name || !email) {
                return res.status(400).send({ success: false, message: "Required fields missing or invalid." });
            }
            try {
                const donationDoc = {
                    campaign_id: new ObjectId(campaign_id),
                    amount_donated: Number(amount_donated),
                    user_name,
                    pet_image: pet_image,
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
        app.get("/dashboard/donors-list/:campaignId", verifyToken, async (req, res) => {
            const campaignId = req.params.campaignId;
            if (!ObjectId.isValid(campaignId)) {
                return res.status(400).send([]);
            }
            const filter = { campaign_id: new ObjectId(campaignId) };
            const donors = await recievedDonationCollection.find(filter).toArray();
            res.send(donors);
        });

        // GET api endpoint to fetch donations added by user using email
        app.get("/dashboard/my-donations/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await recievedDonationCollection.find(filter).toArray();
            res.send(result);
        });

        // DELETE API endpoint to delete a donation by ID
        app.delete("/dashboard/donation-delete/:id", verifyToken, async (req, res) => {
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
