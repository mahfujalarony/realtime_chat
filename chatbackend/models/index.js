const { DataTypes } = require('sequelize')
const sequelize = require('../config/db')
const createUser = require('./User')
const createMessage = require('./Message')
const createMessageReaction = require('./MessageReaction')
const createContact = require('./Contact')
const createPushSubscription = require('./PushSubscription')
const createConversationAssignment = require('./ConversationAssignment')
const createUserBlock = require('./UserBlock')

const User = createUser(sequelize, DataTypes)
const Message = createMessage(sequelize, DataTypes)
const MessageReaction = createMessageReaction(sequelize, DataTypes)
const Contact = createContact(sequelize, DataTypes)
const PushSubscription = createPushSubscription(sequelize, DataTypes)
const ConversationAssignment = createConversationAssignment(sequelize, DataTypes)
const UserBlock = createUserBlock(sequelize, DataTypes)

User.hasMany(Message, { foreignKey: 'senderId', as: 'sentMessages' })
User.hasMany(Message, { foreignKey: 'receiverId', as: 'receivedMessages' })
Message.belongsTo(User, { foreignKey: 'senderId', as: 'sender' })
Message.belongsTo(User, { foreignKey: 'receiverId', as: 'receiver' })
Message.hasMany(MessageReaction, { foreignKey: 'messageId', as: 'reactions' })
MessageReaction.belongsTo(Message, { foreignKey: 'messageId', as: 'message' })
User.hasMany(MessageReaction, { foreignKey: 'userId', as: 'messageReactions' })
MessageReaction.belongsTo(User, { foreignKey: 'userId', as: 'user' })

User.hasMany(Contact, { foreignKey: 'userId', as: 'contacts' })
Contact.belongsTo(User, { foreignKey: 'userId', as: 'owner' })
Contact.belongsTo(User, { foreignKey: 'contactUserId', as: 'contactUser' })

User.hasMany(PushSubscription, { foreignKey: 'userId', as: 'pushSubscriptions' })
PushSubscription.belongsTo(User, { foreignKey: 'userId', as: 'user' })

User.hasOne(ConversationAssignment, { foreignKey: 'externalUserId', as: 'externalAssignment' })
ConversationAssignment.belongsTo(User, { foreignKey: 'externalUserId', as: 'externalUser' })
ConversationAssignment.belongsTo(User, { foreignKey: 'assignedToUserId', as: 'assignedToUser' })
ConversationAssignment.belongsTo(User, { foreignKey: 'publicHandlerUserId', as: 'publicHandlerUser' })
ConversationAssignment.belongsTo(User, { foreignKey: 'assignedByUserId', as: 'assignedByUser' })

User.hasMany(UserBlock, { foreignKey: 'blockerId', as: 'blockedUsers' })
User.hasMany(UserBlock, { foreignKey: 'blockedUserId', as: 'blockedByUsers' })
UserBlock.belongsTo(User, { foreignKey: 'blockerId', as: 'blocker' })
UserBlock.belongsTo(User, { foreignKey: 'blockedUserId', as: 'blockedUser' })

module.exports = {
  sequelize,
  User,
  Message,
  MessageReaction,
  Contact,
  PushSubscription,
  ConversationAssignment,
  UserBlock,
}
