import express from 'express';
import { contactus as Model } from '../models/ContactModel.js';
import { contactus } from '../models/ContactModel.js';

const router = express.Router(); 

// Route for saving a new feedback
router.post("/", async (req, res) => {
    try {
        const { name, email, phone, subject, message } = req.body;

        if (!name || !email || !phone || !subject || !message) {
            return res.status(400).json({ message: "All fields are required" });
        }

        const newContact = new Model({ name, email, phone, subject, message });
        const savedContact = await newContact.save();
        return res.status(201).json(savedContact);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
});

// Route to get all contact entries
router.get("/", async (request, response) => {
    try {
        const contacts = await Model.find({});
        return response.status(200).json(contacts);  // Send array directly
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
});

// Route to get a single contact by ID
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const contact = await Model.findById(id);
        if (!contact) {
            return res.status(404).json({ message: "Contact not found" });
        }
        return res.status(200).json(contact);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
});


// Route for updating a feedback
router.put('/:id', async (request, response) => {
    try {
        if (
            !request.body.name ||
            !request.body.email ||
            !request.body.phone ||
            !request.body.subject ||
            !request.body.message 
        ) {
            return response.status(400).send({
                message: 'Send All required fields: name, email, phone, subject, message',
            });
        }

        const { id } = request.params;

        // Use Model instead of contactus
        const result = await Model.findByIdAndUpdate(id, request.body, { new: true });

        if (!result) {
            return response.status(404).json({ message: 'Feedback not found' });
        }

        return response.status(200).send({ message: 'Feedback Updated successfully', data: result });
    } catch (error) {
        console.log(error.message);
        response.status(500).send({ message: error.message });
    }
});

// Route for deleting a feedback
router.delete('/:id', async (request, response) => {
    try {
        const { id } = request.params;

        // Use Model instead of contactus
        const result = await contactus.findByIdAndDelete(id);

        if (!result) {
            return response.status(404).send({ message: 'Feedback not found' });
        }

        return response.status(200).send({ message: 'Feedback deleted successfully' });
    } catch (error) {
        console.log(error.message);
        response.status(500).send({ message: error.message });
    }
});

export default router;