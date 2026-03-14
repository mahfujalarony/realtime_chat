const { DataTypes } = require('sequelize')
const sequelize = require('../config/db')
const createUser = require('./User')
const createMessage = require('./Message')
const createContact = require('./Contact')
const createPushSubscription = require('./PushSubscription')

const User = createUser(sequelize, DataTypes)
const Message = createMessage(sequelize, DataTypes)
const Contact = createContact(sequelize, DataTypes)
const PushSubscription = createPushSubscription(sequelize, DataTypes)

User.hasMany(Message, { foreignKey: 'senderId', as: 'sentMessages' })
User.hasMany(Message, { foreignKey: 'receiverId', as: 'receivedMessages' })
Message.belongsTo(User, { foreignKey: 'senderId', as: 'sender' })
Message.belongsTo(User, { foreignKey: 'receiverId', as: 'receiver' })

User.hasMany(Contact, { foreignKey: 'userId', as: 'contacts' })
Contact.belongsTo(User, { foreignKey: 'userId', as: 'owner' })
Contact.belongsTo(User, { foreignKey: 'contactUserId', as: 'contactUser' })

User.hasMany(PushSubscription, { foreignKey: 'userId', as: 'pushSubscriptions' })
PushSubscription.belongsTo(User, { foreignKey: 'userId', as: 'user' })

module.exports = {
  sequelize,
  User,
  Message,
  Contact,
  PushSubscription,
}
