require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

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
            console.log(err);
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

        // update pet data
        app.patch("/pet-update/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const updateData = req.body;
            updateData.last_updated = new Date().toISOString();
            const filter = { _id: new ObjectId(id) };
            const update = { $set: updateData };
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
