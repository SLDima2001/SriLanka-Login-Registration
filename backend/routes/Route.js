import express from  'express';
import { feedback as Model} from '../models/Model.js';
import { feedback } from '../models/Model.js';



const router = express.Router(); 

//Route for save a new feedback
router.post("/", async (request, response) => {
    try {
        if (
            !request.body.firstname ||
            !request.body.lastname ||
            !request.body.email ||
            !request.body.phonenumber ||
            !request.body.subject ||
            !request.body.message ||
            !request.body.rating
        ) {
            return response.status(400).send({
                message: "Send All required fields: firstname,lastname,email,phonenumber,Date,subject,message",
            });
        }
        const newfeedback = {
            firstname: request.body.firstname,
            lastname: request.body.lastname,
            email: request.body.email,
            phonenumber:request.body.phonenumber,
            subject:request.body.subject,
            message:request.body.message,
            rating:request.body.rating,
            
        };
        const feedback = await Model.create(newfeedback);


        return response.status(201).send(feedback);
    } catch (error) {
        console.log(error.message);
        response.status(500).send({ message: error.message });
    }
});


//Route for get all feedbacks from database 
router.get("/", async (request, response) => {
    try {
        const feedback = await Model.find({});
        return response.status(200).json(feedback);  // Send array directly
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
});

//Route for get one reservation from database by ID
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const feedback = await Model.findById(id);
        if (!feedback) {
            return res.status(404).json({ message: "Contact not found" });
        }
        return res.status(200).json(feedback);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
});

//Route for update a feedback
router.put('/:id', async (request, response) => {
    try {
        if (
            !request.body.firstname ||
            !request.body.lastname ||
            !request.body.email ||
            !request.body.phonenumber ||
            !request.body.subject ||
            !request.body.message ||
            !request.body.rating 
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


//Route for delete a book
router.delete('/:id', async (request, response) => {
    try {
        const { id } = request.params;

        const result = await feedback.findByIdAndDelete(id);

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