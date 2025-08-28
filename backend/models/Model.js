import mongoose from "mongoose";

const cusfeedback = mongoose.Schema(
    {
            firstname:{
                type:String,
                required:true,
                minlength:1,
                maxlength:100,
                validate: {
                    validator: (value) => {
                        return /^[a-z && A-Z ]{2,30}$/.test(value);
                    },
                    message: 'First name must be alphabets only and between 2 and 30 characters long',
                },
            },
            lastname:{
                type:String,
                required:true,
                minlength:1,
                maxlength:100,
                validate: {
                    validator: (value) => {
                        return /^[a-zA-Z ]{2,30}$/.test(value);
                    },
                    message: 'Last name must be alphabets only and between 2 and 30 characters long',
                },
            },
            email:{
                type:String,
                required:true,
                minlength:1,
                maxlength:100,
                validate: {
                    validator: (value) => {
                        return /^([a-zA-Z0-9_\-\.]+)@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.)|(([a-zA-Z0-9\-]+\.)+))([a-zA-Z]{2,4}|[0-9]{1,3})(\]?)$/.test(value);
                    },
                    message: 'Invalid email address',
                },
            },
            phonenumber:{
                type:Number,
                required:true,
            
            },
            subject:{
                type:String,
                required:true,
                minlength:1,
                maxlength:100,
            },
            message:{
                type:String,
                required:true,
                minlength:1,
                maxlength:1000,
            },
            rating:{
                type:Number,
                required:true,
                min:1,
                max:5,
            },
    },
    {
        timestamps:true,
    }
);

export const feedback = mongoose.model('feedback', cusfeedback);

