import express from 'express';
import { payment as Model } from '../models/PaymentModel.js';
import { payment } from '../models/PaymentModel.js';

const router = express.Router(); 

// Route for saving a new feedback
router.post("/", async (req, res) => {
    try {
        const { name, email, phoneNumber,selectedPackage,persons,fromDate,toDate } = req.body;

        if (!name || !email || !phoneNumber || !selectedPackage || !persons || !fromDate || !toDate) {
            return res.status(400).json({ message: "All fields are required" });
        }

        const newpayment = new Model({ name, email, phoneNumber, selectedPackage,persons, fromDate,toDate});
        const savedpayment = await newpayment.save();
        return res.status(201).json(savedpayment);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
});

// Route to get all contact entries
router.get("/", async (request, response) => {
    try {
        const payment = await Model.find({});
        return response.status(200).json(payment);  // Send array directly
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
});

// Route to get a single contact by ID
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const payment = await Model.findById(id);
        if (!payment) {
            return res.status(404).json({ message: "Contact not found" });
        }
        return res.status(200).json(payment);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
});


// Route for updating a feedback
router.put('/:id', async (request, response) => {
    try {
        if (
            !name || !email || !phoneNumber || !selectedPackage || !persons || !fromDate || !toDate
        ) {
            return response.status(400).send({
                message: 'Send All required fields: name, email, phone, subject, message',
            });
        }

        const { id } = request.params;

        // Use Model instead of contactus
        const result = await Model.findByIdAndUpdate(id, request.body, { new: true });

        if (!result) {
            return response.status(404).json({ message: 'Payment not found' });
        }

        return response.status(200).send({ message: 'Payment Updated successfully', data: result });
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
        const result = await payment.findByIdAndDelete(id);

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