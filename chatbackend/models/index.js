const { DataTypes } = require('sequelize')
const sequelize = require('../config/db')
const createUser = require('./User')
const createMessage = require('./Message')
const createContact = require('./Contact')
const createGroup = require('./Group')
const createGroupMember = require('./GroupMember')
const createGroupMessage = require('./GroupMessage')

const User = createUser(sequelize, DataTypes)
const Message = createMessage(sequelize, DataTypes)
const Contact = createContact(sequelize, DataTypes)
const Group = createGroup(sequelize, DataTypes)
const GroupMember = createGroupMember(sequelize, DataTypes)
const GroupMessage = createGroupMessage(sequelize, DataTypes)

User.hasMany(Message, { foreignKey: 'senderId', as: 'sentMessages' })
User.hasMany(Message, { foreignKey: 'receiverId', as: 'receivedMessages' })
Message.belongsTo(User, { foreignKey: 'senderId', as: 'sender' })
Message.belongsTo(User, { foreignKey: 'receiverId', as: 'receiver' })

User.hasMany(Contact, { foreignKey: 'userId', as: 'contacts' })
Contact.belongsTo(User, { foreignKey: 'userId', as: 'owner' })
Contact.belongsTo(User, { foreignKey: 'contactUserId', as: 'contactUser' })

User.hasMany(Group, { foreignKey: 'createdBy', as: 'createdGroups' })
Group.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' })

Group.hasMany(GroupMember, { foreignKey: 'groupId', as: 'memberships' })
GroupMember.belongsTo(Group, { foreignKey: 'groupId', as: 'group' })
User.hasMany(GroupMember, { foreignKey: 'userId', as: 'groupMemberships' })
GroupMember.belongsTo(User, { foreignKey: 'userId', as: 'memberUser' })

Group.hasMany(GroupMessage, { foreignKey: 'groupId', as: 'messages' })
GroupMessage.belongsTo(Group, { foreignKey: 'groupId', as: 'group' })
User.hasMany(GroupMessage, { foreignKey: 'senderId', as: 'sentGroupMessages' })
GroupMessage.belongsTo(User, { foreignKey: 'senderId', as: 'sender' })

module.exports = {
  sequelize,
  User,
  Message,
  Contact,
  Group,
  GroupMember,
  GroupMessage,
}
