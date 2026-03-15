module.exports = (sequelize, DataTypes) => {
  const ConversationAssignment = sequelize.define(
    'ConversationAssignment',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      externalUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
      },
      assignedToUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      publicHandlerUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      assignedByUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      noteUpdatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'conversation_assignments',
      underscored: true,
      indexes: [
        { unique: true, fields: ['external_user_id'] },
        { fields: ['assigned_to_user_id'] },
      ],
    },
  )

  return ConversationAssignment
}
