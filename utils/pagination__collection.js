// Utility function for paginating a MongoDB collection
const paginateCollection = async ({ collection, req, filter = {}, projection = null }) => {
    // Parse query params for pagination
    const pageSize = Number.parseInt(req.query.limit) || 6; // Number of items per page
    const cursor = Number.parseInt(req.query.cursor) || 0;  // Current cursor position

    // Count total documents matching the filter
    const total = await collection.countDocuments(filter);

    // Adjust cursor if it exceeds total
    const adjustedCursor = cursor >= total ? Math.max(total - pageSize, 0) : cursor;

    // Fetch paginated items from the collection
    const items = await collection
        .find(filter, { projection })
        .skip(adjustedCursor)
        .limit(pageSize)
        .toArray();

    // Calculate next and previous cursor positions
    const nextId = adjustedCursor + pageSize < total ? adjustedCursor + pageSize : null;
    const previousId = adjustedCursor - pageSize >= 0 ? adjustedCursor - pageSize : null;

    // Return paginated result
    return { items, nextId, previousId, total };
};

module.exports = paginateCollection;
