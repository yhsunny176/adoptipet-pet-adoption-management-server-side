const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");

// GET /api/pet-recommendations
const getPetRecommendations = (petCollection) => async (req, res) => {
    try {
        const { categories, district, limit = 12 } = req.query;

        // Convert categories to array if it's a single value
        const categoryArray = Array.isArray(categories) ? categories : [categories];

        // Build MongoDB query
        const query = {
            // Filter by pet categories
            category: { $in: categoryArray },

            // Filter by location/district (using location field with text search)
            location: { $regex: district, $options: "i" },

            // Only show available pets (not adopted)
            adopted: false,
        };

        // Fetch pets from database with user information
        const recommendations = await petCollection
            .aggregate([
                { $match: query },
                {
                    $lookup: {
                        from: "users",
                        localField: "added_by",
                        foreignField: "_id",
                        as: "added_by",
                    },
                },
                {
                    $unwind: {
                        path: "$added_by",
                        preserveNullAndEmptyArrays: true,
                    },
                },
                {
                    $project: {
                        "added_by.password": 0,
                        "added_by.email": 0,
                    },
                },
                { $sort: { created_at: -1 } },
                { $limit: parseInt(limit) },
            ])
            .toArray();

        res.status(200).json(recommendations);
    } catch (error) {
        console.error("Error fetching pet recommendations:", error);
        res.status(500).json({
            error: "Failed to fetch recommendations",
            message: error.message,
        });
    }
};

// Advanced recommendation with scoring
const getAdvancedPetRecommendations = (petCollection) => async (req, res) => {
    try {
        const { categories, district, limit = 12 } = req.query;

        const categoryArray = Array.isArray(categories) ? categories : [categories];

        // Use MongoDB aggregation for more complex matching
        const recommendations = await petCollection
            .aggregate([
                // Basic filtering
                {
                    $match: {
                        category: { $in: categoryArray },
                        adopted: false,
                        $or: [
                            { location: { $regex: district, $options: "i" } },
                            { location: { $exists: false } }, // Include pets without location
                        ],
                    },
                },

                //Lookup user information
                {
                    $lookup: {
                        from: "users",
                        localField: "added_by",
                        foreignField: "_id",
                        as: "added_by",
                    },
                },
                {
                    $unwind: {
                        path: "$added_by",
                        preserveNullAndEmptyArrays: true,
                    },
                },

                // Add scoring fields
                {
                    $addFields: {
                        // Score based on location match
                        locationScore: {
                            $cond: [
                                { $regexMatch: { input: "$location", regex: district, options: "i" } },
                                10, // Text match gets 10 points
                                5, // No location or different location gets 5 points
                            ],
                        },

                        // Score based on how recent the listing is
                        freshnessScore: {
                            $subtract: [
                                10,
                                {
                                    $divide: [
                                        { $subtract: [new Date(), "$created_at"] },
                                        86400000, // Convert to days
                                    ],
                                },
                            ],
                        },
                    },
                },

                // Stage 4: Calculate total score
                {
                    $addFields: {
                        totalScore: { $add: ["$locationScore", "$freshnessScore"] },
                    },
                },

                // Sort by score
                { $sort: { totalScore: -1, created_at: -1 } },

                // Limit results
                { $limit: parseInt(limit) },

                // Clean up the output
                {
                    $project: {
                        locationScore: 0,
                        freshnessScore: 0,
                        totalScore: 0,
                        "added_by.password": 0,
                        "added_by.email": 0,
                    },
                },
            ])
            .toArray();

        res.status(200).json(recommendations);
    } catch (error) {
        console.error("Error fetching advanced pet recommendations:", error);
        res.status(500).json({
            error: "Failed to fetch recommendations",
            message: error.message,
        });
    }
};

module.exports = { getPetRecommendations, getAdvancedPetRecommendations };
